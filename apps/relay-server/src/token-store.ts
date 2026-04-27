import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeRelayPairingCode, type RelayPrincipalType } from "@apreal/shared";
import { generateToken, readRelayToken, type AuthTokenPayload, type UserType } from "./auth.ts";

type RelayStoredTokenFile = {
	tokens: string[];
};

export type StoredRelayToken = {
	token: string;
	payload: AuthTokenPayload;
};

type IssueTokenInput = {
	type: UserType;
	id: string;
	key: string;
	pairingCode?: string;
	targetId?: string;
	targetType?: RelayPrincipalType;
	serverUrl?: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDefaultStorePath(): string {
	const configuredPath = process.env.RELAY_TOKEN_STORE_PATH?.trim();
	if (configuredPath) {
		return resolve(configuredPath);
	}

	const legacyConfiguredPath = process.env.RELAY_SQLITE_PATH?.trim();
	if (legacyConfiguredPath) {
		return resolve(dirname(resolve(legacyConfiguredPath)), "relay-issued-tokens.json");
	}

	return resolve(process.cwd(), ".data", "relay-issued-tokens.json");
}

export class RelayTokenStore {
	private readonly filePath: string;

	constructor(filePath = getDefaultStorePath()) {
		this.filePath = filePath;
	}

	getFilePath(): string {
		return this.filePath;
	}

	countTokens(options?: { allowExpired?: boolean }): number {
		return this.listTokens(options).length;
	}

	findActiveToken(token: string): StoredRelayToken | null {
		return this.parseStoredToken(token, false);
	}

	findLatestByPrincipal(
		type: UserType,
		id: string,
		key: string,
		options?: { allowExpired?: boolean },
	): StoredRelayToken | null {
		for (const entry of this.listTokens({ allowExpired: options?.allowExpired ?? true })) {
			if (entry.payload.type !== type || entry.payload.id !== id || entry.payload.key !== key) {
				continue;
			}

			return entry;
		}

		return null;
	}

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

	findPendingClientByPairingCode(pairingCode: string): StoredRelayToken | null {
		const normalizedPairingCode = normalizeRelayPairingCode(pairingCode);
		if (!normalizedPairingCode) {
			return null;
		}

		for (const entry of this.listTokens({ allowExpired: true })) {
			if (entry.payload.type !== "client") {
				continue;
			}

			if (entry.payload.targetId) {
				continue;
			}

			if (entry.payload.pairingCode !== normalizedPairingCode) {
				continue;
			}

			return entry;
		}

		return null;
	}

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

	findAgentServerUrl(agentId: string): string | null {
		for (const entry of this.listTokens({ allowExpired: true })) {
			if (entry.payload.type !== "agent" || entry.payload.id !== agentId) {
				continue;
			}

			return entry.payload.serverUrl ?? null;
		}

		return null;
	}

	clearClientTarget(entry: StoredRelayToken, pairingCode = this.createPairingCode()): StoredRelayToken {
		return this.issueToken({
			type: "client",
			id: entry.payload.id,
			key: entry.payload.key,
			pairingCode,
		});
	}

	issueToken(input: IssueTokenInput): StoredRelayToken {
		const nextTokens = this.readRawTokens().filter((candidate) => {
			const parsed = this.parseStoredToken(candidate, true);
			if (!parsed) {
				return false;
			}

			return !(
				parsed.payload.type === input.type &&
				parsed.payload.id === input.id &&
				parsed.payload.key === input.key
			);
		});

		const token = generateToken(input);
		nextTokens.push(token);
		this.writeRawTokens(nextTokens);

		const storedToken = this.parseStoredToken(token, false);
		if (!storedToken) {
			throw new Error("failed to read newly issued relay token");
		}

		return storedToken;
	}

	createPairingCode(): string {
		for (let attempts = 0; attempts < 32; attempts += 1) {
			const candidate = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
			if (!this.findPendingClientByPairingCode(candidate)) {
				return candidate;
			}
		}

		throw new Error("failed to generate a unique pairing code");
	}

	private listTokens(options?: { allowExpired?: boolean }): StoredRelayToken[] {
		const entries: StoredRelayToken[] = [];
		for (const token of this.readRawTokens()) {
			const parsed = this.parseStoredToken(token, options?.allowExpired ?? false);
			if (!parsed) {
				continue;
			}

			entries.push(parsed);
		}

		entries.sort((left, right) => right.payload.iat - left.payload.iat);
		return entries;
	}

	private parseStoredToken(token: string, allowExpired: boolean): StoredRelayToken | null {
		try {
			return {
				token,
				payload: readRelayToken(token, { ignoreExpiration: allowExpired }),
			};
		} catch {
			return null;
		}
	}

	private readRawTokens(): string[] {
		if (!existsSync(this.filePath)) {
			return [];
		}

		try {
			const content = readFileSync(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(content);
			if (!isObjectRecord(parsed) || !Array.isArray(parsed.tokens)) {
				return [];
			}

			return parsed.tokens.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
		} catch {
			return [];
		}
	}

	private writeRawTokens(tokens: string[]) {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const payload: RelayStoredTokenFile = {
			tokens,
		};
		writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}
}
