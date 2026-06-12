import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { assertRelayPrincipalId } from "@apreal/shared";

import { getRelayEnv } from "./env.ts";

type OwnerBindingStoreFile = {
	agents: StoredOwnerAgentBinding[];
};

// Single persisted owner<->agent association record stored on disk.
export type StoredOwnerAgentBinding = {
	agentId: string;
	agentKey: string;
	ownerUserId: string;
	updatedAt: number;
};

// Shared guard for JSON loaded from disk before the store trusts its shape.
function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Normalizes externally supplied principal ids before storing or matching them.
function ensureId(value: unknown, field: string): string {
	return assertRelayPrincipalId(value, field);
}

// Resolves the JSON file path used to persist owner bindings across relay
// restarts.
function getDefaultStorePath(): string {
	const env = getRelayEnv();
	const configuredPath = env.RELAY_OWNER_BINDING_STORE_PATH ?? env.RELAY_TOKEN_STORE_PATH;
	if (configuredPath) {
		return resolve(configuredPath);
	}

	const legacyConfiguredPath = env.RELAY_SQLITE_PATH;
	if (legacyConfiguredPath) {
		return resolve(dirname(resolve(legacyConfiguredPath)), "relay-owner-bindings.json");
	}

	return resolve(process.cwd(), ".data", "relay-owner-bindings.json");
}

// Converts a parsed JSON entry into a validated binding record, dropping any
// malformed data instead of crashing the relay.
function parseStoredBinding(value: unknown): StoredOwnerAgentBinding | null {
	if (!isObjectRecord(value)) {
		return null;
	}

	try {
		const agentId = ensureId(value.agentId, "agentId");
		const agentKey = ensureId(value.agentKey, "agentKey");
		const ownerUserId = ensureId(value.ownerUserId, "ownerUserId");
		const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
			? value.updatedAt
			: Date.now();
		return {
			agentId,
			agentKey,
			ownerUserId,
			updatedAt,
		};
	} catch {
		return null;
	}
}

// Small JSON-backed store that remembers the one active agent last bound by a
// signed-in owner.
export class RelayOwnerBindingStore {
	private readonly filePath: string;

	// Allows tests to inject an isolated store path while production uses the
	// default relay data location.
	constructor(filePath = getDefaultStorePath()) {
		this.filePath = filePath;
	}

	// Exposes the resolved backing file path for logs and health output.
	getFilePath(): string {
		return this.filePath;
	}

	// Returns the number of valid bindings currently persisted on disk.
	countBindings(): number {
		return this.readBindings().length;
	}

	// Upserts the binding for one agent and removes any previous agent for the
	// same owner so the relay keeps a single active agent per account.
	bindAgentToOwner(agentId: string, agentKey: string, ownerUserId: string): StoredOwnerAgentBinding {
		const binding: StoredOwnerAgentBinding = {
			agentId: ensureId(agentId, "agentId"),
			agentKey: ensureId(agentKey, "agentKey"),
			ownerUserId: ensureId(ownerUserId, "ownerUserId"),
			updatedAt: Date.now(),
		};

		const nextBindings = this.readBindings().filter((entry) =>
			entry.agentId !== binding.agentId && entry.ownerUserId !== binding.ownerUserId
		);
		nextBindings.push(binding);
		this.writeBindings(nextBindings);
		return binding;
	}

	// Looks up which owner previously authenticated a specific agent id/key pair.
	findOwnerUserIdForAgent(agentId: string, agentKey: string): string | null {
		for (const binding of this.readBindings()) {
			if (binding.agentId === agentId && binding.agentKey === agentKey) {
				return binding.ownerUserId;
			}
		}

		return null;
	}

	// Returns the most recently updated agent binding for a given owner.
	findLatestAgentByOwnerUserId(ownerUserId: string): StoredOwnerAgentBinding | null {
		const normalizedOwnerUserId = ensureId(ownerUserId, "ownerUserId");
		for (const binding of this.readBindings()) {
			if (binding.ownerUserId === normalizedOwnerUserId) {
				return binding;
			}
		}

		return null;
	}

	// Reads and validates the persisted JSON file, returning newest bindings
	// first so callers can pick the latest match.
	private readBindings(): StoredOwnerAgentBinding[] {
		if (!existsSync(this.filePath)) {
			return [];
		}

		try {
			const content = readFileSync(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(content);
			if (!isObjectRecord(parsed) || !Array.isArray(parsed.agents)) {
				return [];
			}

			return parsed.agents
				.map(parseStoredBinding)
				.filter((binding): binding is StoredOwnerAgentBinding => binding !== null)
				.sort((left, right) => right.updatedAt - left.updatedAt);
		} catch {
			return [];
		}
	}

	// Rewrites the binding file with the supplied validated records.
	private writeBindings(bindings: StoredOwnerAgentBinding[]) {
		mkdirSync(dirname(this.filePath), { recursive: true });

		const payload: OwnerBindingStoreFile = {
			agents: bindings,
		};

		writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}
}
