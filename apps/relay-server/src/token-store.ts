// ---------------------------------------------------------------------------
// Node.js built-in imports
// ---------------------------------------------------------------------------
// existsSync  – checks whether the token store file already exists on disk
// mkdirSync   – creates the parent directory for the token store if missing
// readFileSync – reads the raw JSON content of the token store file
// writeFileSync – atomically (sync) writes the updated token list back to disk
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// dirname – extracts the parent directory from a file path (used when
//           computing the token store location from a legacy env variable)
// resolve – resolves a relative path to an absolute one
import { dirname, resolve } from "node:path";

// normalizeRelayPairingCode – sanitises a user-provided pairing code so
//   lookups are case-insensitive and whitespace-tolerant
// RelayPrincipalType – discriminated union of the principals the relay
//   mediates between (client, agent, server, etc.)
import { normalizeRelayPairingCode, type RelayPrincipalType } from "@apreal/shared";

// generateToken   – creates a signed JWT given the token input payload
// readRelayToken  – verifies the JWT signature and decodes the payload; throws
//                   if the token is malformed or expired (unless instructed to
//                   ignore expiration)
// AuthTokenPayload – the shape of the decoded JWT body (type, id, key, iat,
//                    exp, pairingCode, targetId, targetType, serverUrl, etc.)
// UserType – the discriminated union of "client" | "agent" | "server"
import { generateToken, readRelayToken, type AuthTokenPayload, type UserType } from "./auth.ts";

// ---------------------------------------------------------------------------
// On-disk schema for the token store file.
//
// The file is a JSON object with a single key "tokens" whose value is an
// array of JWT strings. This format keeps the store self-describing: other
// tools can inspect the file and immediately understand its shape.
// ---------------------------------------------------------------------------
type RelayStoredTokenFile = {
	tokens: string[];
};

// ---------------------------------------------------------------------------
// In-memory representation of a stored token.
//
// We keep the raw JWT string around so we can send it back to callers (e.g.
// the client needs the exact token bytes for its Authorization header).
// The `payload` field holds the *already-decoded* claims so callers don't
// need to re-decode or re-verify the token on every access.
// ---------------------------------------------------------------------------
export type StoredRelayToken = {
	/** The raw, signed JWT string as persisted on disk and sent over the wire. */
	token: string;
	/** The decoded (and signature-verified) claims inside the JWT. */
	payload: AuthTokenPayload;
};

// ---------------------------------------------------------------------------
// Input shape for `RelayTokenStore.issueToken()`.
//
// Every token issued by the relay carries at minimum (type, id, key). The
// remaining fields are context-dependent:
//   - pairingCode  → set for unpaired client tokens so an agent can claim them
//   - targetId      → set once pairing is complete so the relay knows how to
//                     route messages between the two principals
//   - targetType    → discriminator for the target (e.g. "agent" or "client")
//   - serverUrl     → the local server URL an agent advertises; stored so the
//                     relay can forward client requests to the right laptop
// ---------------------------------------------------------------------------
type IssueTokenInput = {
	/** The kind of principal: "client", "agent", or "server". */
	type: UserType;
	/** A unique, stable identifier for the principal (e.g. a machine id or
	 *  username-derived hash). */
	id: string;
	/** A per-session key that distinguishes different sessions for the same
	 *  principal. Re-issuing a token for the same (type, id, key) tuple
	 *  *replaces* the previous one (it does NOT append). */
	key: string;
	/** A human-friendly or machine-generated code used during the handshake
	 *  to pair a client with an agent. Only meaningful for client tokens. */
	pairingCode?: string;
	/** The id of the principal this token is paired with.
	 *  For a client: the agent's id.
	 *  For an agent: the client's id. */
	targetId?: string;
	/** The type of the principal identified by `targetId`. */
	targetType?: RelayPrincipalType;
	/** For agent tokens: the URL of the local server the agent is running on,
	 *  so the relay knows where to forward incoming client requests. */
	serverUrl?: string;
};

// ---------------------------------------------------------------------------
// Type-narrowing helper that validates an `unknown` value is a plain object
// (not null and not an array). Used when parsing the token store JSON to
// confirm the top-level container has the expected shape before reaching
// into its properties.
// ---------------------------------------------------------------------------
function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Determines the filesystem path for the relay-issued-tokens JSON file.
//
// Resolution order (highest priority first):
//   1. RELAY_TOKEN_STORE_PATH env variable – full path to the JSON file
//   2. RELAY_SQLITE_PATH env variable (legacy) – path to the old SQLite DB;
//      we derive the JSON store path from its parent directory
//   3. Default: <cwd>/.data/relay-issued-tokens.json
//
// This allows operators to colocate the token store with their relay data
// directory without hardcoding a specific layout.
// ---------------------------------------------------------------------------
function getDefaultStorePath(): string {
	// Explicit, dedicated env variable for the token store file path.
	const configuredPath = process.env.RELAY_TOKEN_STORE_PATH?.trim();
	if (configuredPath) {
		return resolve(configuredPath);
	}

	// Legacy: some deployments set RELAY_SQLITE_PATH to point to the SQLite
	// database. We place the token store JSON in the same directory for
	// backward compatibility.
	const legacyConfiguredPath = process.env.RELAY_SQLITE_PATH?.trim();
	if (legacyConfiguredPath) {
		return resolve(dirname(resolve(legacyConfiguredPath)), "relay-issued-tokens.json");
	}

	// Sensible default: a `.data` folder in the current working directory.
	return resolve(process.cwd(), ".data", "relay-issued-tokens.json");
}

// ---------------------------------------------------------------------------
// RelayTokenStore
// ---------------------------------------------------------------------------
// Persisted, file-backed registry of every JWT issued by this relay server.
//
// WHY A FILE INSTEAD OF A DATABASE?
//   The relay typically runs on the same machine as the server, with low
//   throughput. A JSON file is trivially inspectable, requires zero setup,
//   and the entire dataset fits comfortably in memory. If scale demands
//   change, the public API of this class can be backed by SQLite without
//   affecting callers.
//
// CONCURRENCY MODEL:
//   The store is NOT protected by a mutex. Node.js's single-threaded event
//   loop means two writes cannot interleave *in-process*. If multiple relay
//   processes share the same file they will clobber each other, but that
//   scenario is deliberately out of scope.
//
// TOKEN LIFECYCLE:
//   1. Client calls /issue → issueToken({ type: "client", pairingCode })
//      → token is stored with pairingCode set, targetId empty
//   2. Agent calls /pair (with pairingCode) → relay finds the pending
//      client token via findPendingClientByPairingCode(), then issues a new
//      agent token with targetId = client.id and a new client token with
//      targetId = agent.id. The old client token is replaced.
//   3. Relay uses findLatestClientByTargetId() / findAgentServerUrl() to
//      route subsequent messages.
//   4. Expired tokens are lazily pruned – they are ignored by lookups that
//      don't pass allowExpired: true, and they are overwritten when a new
//      token for the same (type, id, key) is issued.
// ---------------------------------------------------------------------------
export class RelayTokenStore {
	/** Absolute path to the JSON file on disk. */
	private readonly filePath: string;

	/**
	 * @param filePath  Optional override for the token store file path.
	 *                  When omitted, the path is resolved via
	 *                  `getDefaultStorePath()`.
	 */
	constructor(filePath = getDefaultStorePath()) {
		this.filePath = filePath;
	}

	// -----------------------------------------------------------------------
	// Public: informational / introspection
	// -----------------------------------------------------------------------

	/** Exposes the filesystem path so external code (e.g. health checks) can
	 *  inspect the file directly. */
	getFilePath(): string {
		return this.filePath;
	}

	/**
	 * Returns the number of tokens currently persisted on disk.
	 *
	 * @param options.allowExpired – when false (default), expired tokens are
	 *   excluded from the count. Pass true to include every token ever issued.
	 */
	countTokens(options?: { allowExpired?: boolean }): number {
		return this.listTokens(options).length;
	}

	// -----------------------------------------------------------------------
	// Public: token lookup
	// -----------------------------------------------------------------------

	/**
	 * Looks up a single token by its raw JWT string.
	 *
	 * This is the most direct lookup: the caller already possesses the token
	 * bytes (e.g. from an Authorization header) and needs to verify it is
	 * still active (not expired and still present in the store).
	 *
	 * @returns The decoded token, or `null` if the token is expired, has been
	 *          replaced, or was never issued by this relay.
	 */
	findActiveToken(token: string): StoredRelayToken | null {
		// `allowExpired: false` means readRelayToken will throw if the JWT
		// is past its `exp` claim, and parseStoredToken will return null.
		return this.parseStoredToken(token, false);
	}

	/**
	 * Finds the most-recently-issued token for a specific (type, id, key)
	 * triple. The `key` acts as a session discriminator so the same principal
	 * can hold multiple concurrent sessions.
	 *
	 * By default, expired tokens ARE returned (the caller can override via
	 * `options.allowExpired`) because the pairing flow often needs to find a
	 * recently-expired token to understand what the client/agent was last
	 * connected to.
	 *
	 * @param type  "client", "agent", or "server"
	 * @param id    Stable principal identifier
	 * @param key   Session key
	 * @returns The newest matching token, or `null` if none exists.
	 */
	findLatestByPrincipal(
		type: UserType,
		id: string,
		key: string,
		options?: { allowExpired?: boolean },
	): StoredRelayToken | null {
		// listTokens already returns entries sorted newest-first (by `iat`).
		// We iterate and return the first match, which is effectively the
		// latest because of the sort order.
		for (const entry of this.listTokens({ allowExpired: options?.allowExpired ?? true })) {
			if (entry.payload.type !== type || entry.payload.id !== id || entry.payload.key !== key) {
				continue;
			}

			return entry;
		}

		return null;
	}

	/**
	 * Finds the most-recently-issued token for a given principal identity,
	 * matching only on (type, id) – ignoring the session key.
	 *
	 * This is a looser lookup than `findLatestByPrincipal`. It is useful
	 * when the caller knows *who* the principal is but doesn't have (or care
	 * about) the exact session key.
	 *
	 * Unlike `findLatestByPrincipal`, this defaults to `allowExpired: false`
	 * because this lookup is typically used for routing decisions where an
	 * expired token is useless.
	 */
	findLatestByPrincipalId(
		type: UserType,
		id: string,
		options?: { allowExpired?: boolean },
	): StoredRelayToken | null {
		for (const entry of this.listTokens({ allowExpired: options?.allowExpired ?? false })) {
			if (entry.payload.type !== type || entry.payload.id !== id) {
				continue;
			}

			return entry;
		}

		return null;
	}

	/**
	 * Locates a client token that is waiting to be paired.
	 *
	 * A client token is "pending" when:
	 *   1. Its `type` is "client"
	 *   2. Its `targetId` is NOT set (meaning no agent has claimed it yet)
	 *   3. Its `pairingCode` matches the provided code (after normalisation)
	 *
	 * This is the core of the handshake: an agent submits a pairing code,
	 * the relay finds the waiting client, and then the relay creates the
	 * bidirectional pairing by setting targetId on both tokens.
	 *
	 * @param pairingCode  The code the agent read from the client's screen
	 *                     (or entered manually).
	 * @returns The pending client token, or `null` if no unmatched client
	 *          has that pairing code.
	 */
	findPendingClientByPairingCode(pairingCode: string): StoredRelayToken | null {
		// Normalise the code so that case differences and accidental
		// whitespace don't prevent pairing.
		const normalizedPairingCode = normalizeRelayPairingCode(pairingCode);
		if (!normalizedPairingCode) {
			return null;
		}

		// We check ALL tokens, including expired ones, because the client
		// might have been waiting for a while and their token could have
		// lapsed. The caller can decide whether to reject an expired token.
		for (const entry of this.listTokens({ allowExpired: true })) {
			// Only client tokens can be pending.
			if (entry.payload.type !== "client") {
				continue;
			}

			// If `targetId` is already set, this client is already paired
			// with an agent – it is NOT pending.
			if (entry.payload.targetId) {
				continue;
			}

			// Compare the normalised codes.
			if (entry.payload.pairingCode !== normalizedPairingCode) {
				continue;
			}

			return entry;
		}

		return null;
	}

	/**
	 * Finds the most-recently-issued client token that is paired with the
	 * given target (agent) id.
	 *
	 * Used during message routing: when the relay receives a message from an
	 * agent addressed to a client, it uses this to verify the client exists
	 * and is still active.
	 *
	 * By default, expired tokens are excluded because a message cannot be
	 * delivered to a client whose session has timed out.
	 */
	findLatestClientByTargetId(targetId: string, options?: { allowExpired?: boolean }): StoredRelayToken | null {
		for (const entry of this.listTokens({ allowExpired: options?.allowExpired ?? false })) {
			if (entry.payload.type !== "client") {
				continue;
			}

			if (entry.payload.targetId !== targetId) {
				continue;
			}

			return entry;
		}

		return null;
	}

	/**
	 * Retrieves the `serverUrl` that an agent registered when it was issued
	 * its token.
	 *
	 * The relay stores this URL so that when a client sends a request, the
	 * relay knows which laptop (and port) to forward the request to.
	 *
	 * Expired tokens are considered because the relay may still need to
	 * know where the agent *was* running for diagnostic or reconnect flows.
	 *
	 * @param agentId  The stable id of the agent principal.
	 * @returns The server URL string, or `null` if the agent has no token
	 *          or never registered a URL.
	 */
	findAgentServerUrl(agentId: string): string | null {
		for (const entry of this.listTokens({ allowExpired: true })) {
			if (entry.payload.type !== "agent" || entry.payload.id !== agentId) {
				continue;
			}

			return entry.payload.serverUrl ?? null;
		}

		return null;
	}

	// -----------------------------------------------------------------------
	// Public: token mutation
	// -----------------------------------------------------------------------

	/**
	 * Unpairs a client by issuing a fresh token that retains the client's
	 * identity but clears the `targetId` and assigns a new `pairingCode`.
	 *
	 * This effectively puts the client back into the "waiting to be paired"
	 * state. The old agent→client link is severed (the agent's old token
	 * will point to a client token ID that no longer exists).
	 *
	 * @param entry       The current client token to invalidate.
	 * @param pairingCode An optional new pairing code. When omitted, a fresh
	 *                    unique code is generated via `createPairingCode()`.
	 * @returns The newly issued (unpaired) client token.
	 */
	clearClientTarget(entry: StoredRelayToken, pairingCode = this.createPairingCode()): StoredRelayToken {
		// Re-issue the token with the same (type, id, key) but without
		// targetId. The `issueToken` method automatically *replaces* the old
		// token for this principal because of the deduplication logic.
		return this.issueToken({
			type: "client",
			id: entry.payload.id,
			key: entry.payload.key,
			pairingCode,
		});
	}

	/**
	 * Creates a new JWT, persists it to disk, and returns the decoded result.
	 *
	 * DEDUPLICATION: If a token already exists for the same (type, id, key)
	 * tuple, the old token is **replaced** (not appended). This means a
	 * principal can only hold one active session per key at a time.
	 *
	 * The old token is removed from the store entirely – it cannot be used
	 * for authentication after this call.
	 *
	 * @throws If the newly generated token cannot be read back after writing
	 *         (which should only happen if the signing key changed between
	 *         generateToken and readRelayToken, or if the filesystem is
	 *         corrupt).
	 */
	issueToken(input: IssueTokenInput): StoredRelayToken {
		// Step 1: Read the current token list and filter OUT any existing
		// token that matches the same (type, id, key) triple. This is the
		// deduplication/replacement step.
		const nextTokens = this.readRawTokens().filter((candidate) => {
			const parsed = this.parseStoredToken(candidate, true);
			if (!parsed) {
				// Malformed or unparseable tokens are also dropped during
				// this filter pass, which serves as a lazy cleanup.
				return false;
			}

			// Keep the token only if it does NOT match the incoming triple.
			// Matching tokens are removed (i.e. replaced).
			return !(
				parsed.payload.type === input.type &&
				parsed.payload.id === input.id &&
				parsed.payload.key === input.key
			);
		});

		// Step 2: Generate a fresh signed JWT from the input claims.
		const token = generateToken(input);

		// Step 3: Append the new token and write the whole list back to disk.
		nextTokens.push(token);
		this.writeRawTokens(nextTokens);

		// Step 4: Re-read the token to confirm it was persisted correctly
		// and return the decoded form to the caller.
		const storedToken = this.parseStoredToken(token, false);
		if (!storedToken) {
			throw new Error("failed to read newly issued relay token");
		}

		return storedToken;
	}

	/**
	 * Generates a unique 8-character uppercase hex pairing code.
	 *
	 * The code is derived from a random UUID (without hyphens, first 8
	 * chars) and is checked against the store to ensure no pending client
	 * is currently using it. In the astronomically unlikely event of a
	 * collision, up to 31 retries are attempted before throwing.
	 *
	 * Codes are all-uppercase so they are easy to read aloud and type
	 * manually. The normalisation step in `findPendingClientByPairingCode`
	 * makes lookup case-insensitive regardless.
	 *
	 * @throws If 32 attempts fail to produce a unique code (should never
	 *         happen in practice with 16^8 possible codes).
	 */
	createPairingCode(): string {
		for (let attempts = 0; attempts < 32; attempts += 1) {
			// crypto.randomUUID() → "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
			// .replace(/-/g, "") → "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx" (32 hex chars)
			// .slice(0, 8)       → first 8 hex chars
			// .toUpperCase()    → "ABCD1234"
			const candidate = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

			// Verify no pending client currently has this code.
			if (!this.findPendingClientByPairingCode(candidate)) {
				return candidate;
			}
		}

		throw new Error("failed to generate a unique pairing code");
	}

	// -----------------------------------------------------------------------
	// Private: internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Reads all raw token strings from disk, parses each one into its
	 * decoded form, and returns them sorted by issuance time (newest first).
	 *
	 * This is the backbone method that all public lookups delegate to.
	 * Sorting by `iat` descending means the first match in a linear scan
	 * is always the most-recently-issued token for that criteria.
	 *
	 * @param options.allowExpired – when true, expired tokens are still
	 *   parsed and included in the returned list. When false, tokens whose
	 *   `exp` claim has passed are silently dropped.
	 */
	private listTokens(options?: { allowExpired?: boolean }): StoredRelayToken[] {
		const entries: StoredRelayToken[] = [];

		// Iterate every raw JWT string on disk.
		for (const token of this.readRawTokens()) {
			// Parse and verify the JWT. If allowExpired is false,
			// `readRelayToken` will throw for expired tokens, causing
			// `parseStoredToken` to return null (they are skipped).
			const parsed = this.parseStoredToken(token, options?.allowExpired ?? false);
			if (!parsed) {
				continue;
			}

			entries.push(parsed);
		}

		// Sort descending by `iat` (issued-at timestamp) so callers that
		// pick the first match get the newest token.
		entries.sort((left, right) => right.payload.iat - left.payload.iat);
		return entries;
	}

	/**
	 * Verifies and decodes a single JWT string.
	 *
	 * @param token         The raw JWT to parse.
	 * @param allowExpired  When true, `readRelayToken` is told to skip the
	 *                      expiration check (`exp` claim). When false, an
	 *                      expired token causes `readRelayToken` to throw,
	 *                      which this method catches and converts to `null`.
	 * @returns The decoded token, or `null` if the JWT is malformed, has
	 *          been tampered with (bad signature), or is expired (when
	 *          `allowExpired` is false).
	 */
	private parseStoredToken(token: string, allowExpired: boolean): StoredRelayToken | null {
		try {
			return {
				token,
				payload: readRelayToken(token, { ignoreExpiration: allowExpired }),
			};
		} catch {
			// The catch swallows all errors:
			//   - JWT signature verification failure (tampering / wrong key)
			//   - JWT expired (only when allowExpired is false)
			//   - Malformed token (not a valid JWT structure)
			//   - Payload doesn't match AuthTokenPayload shape
			// In all cases we treat the token as non-existent.
			return null;
		}
	}

	/**
	 * Reads the raw JWT string array from the token store JSON file.
	 *
	 * DEFENSIVE PARSING: The method validates every level of the loaded data:
	 *   1. File must exist (returns empty array if missing)
	 *   2. File contents must be valid JSON (returns empty array on parse
	 *      error)
	 *   3. Parsed value must be a plain object (not array, not null, not
	 *      primitive)
	 *   4. Parsed value must have a `tokens` key that is an array
	 *   5. Each element of `tokens` must be a non-empty string
	 *
	 * This ensures the store degrades gracefully if the file is manually
	 * edited and accidentally malformed, or if a previous write was
	 * interrupted mid-write.
	 */
	private readRawTokens(): string[] {
		// If the file doesn't exist, there are no tokens yet – return empty.
		if (!existsSync(this.filePath)) {
			return [];
		}

		try {
			const content = readFileSync(this.filePath, "utf8");

			// Parse the file content as JSON. `JSON.parse` returns `unknown`,
			// so we must validate the shape manually.
			const parsed: unknown = JSON.parse(content);

			// Guard: top-level must be a plain object with a "tokens" array.
			if (!isObjectRecord(parsed) || !Array.isArray(parsed.tokens)) {
				return [];
			}

			// Filter to only non-empty strings. This protects against
			// corrupted entries (e.g. a number or `null` in the array).
			return parsed.tokens.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			);
		} catch {
			// If ANYTHING goes wrong (disk error, JSON parse error, etc.),
			// return an empty array so the relay can continue operating.
			// The next `issueToken` call will overwrite the file anyway.
			return [];
		}
	}

	/**
	 * Atomically writes the full token list to the JSON file on disk.
	 *
	 * The write is synchronous to guarantee that once `writeRawTokens`
	 * returns, the data is durably on disk (modulo OS-level write caching).
	 * The parent directory is created recursively if it doesn't exist, so
	 * the first write to a fresh deployment will create the `.data/` folder.
	 *
	 * The JSON is pretty-printed with 2-space indentation and a trailing
	 * newline so operators can `cat` or `jq` the file comfortably.
	 *
	 * @param tokens  The complete, deduplicated list of JWT strings to
	 *                persist. This REPLACES the entire file contents.
	 */
	private writeRawTokens(tokens: string[]) {
		// Ensure the parent directory tree exists (e.g. `./data/`).
		mkdirSync(dirname(this.filePath), { recursive: true });

		const payload: RelayStoredTokenFile = {
			tokens,
		};

		// Pretty-print for human readability. The trailing newline is a
		// POSIX convention that makes `cat` output cleaner.
		writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}
}
