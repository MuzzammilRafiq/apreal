import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { assertRelayPrincipalId } from "@apreal/shared";

import { getRelayEnv } from "./env.ts";

type OwnerBindingStoreFile = {
	agents: StoredOwnerAgentBinding[];
};

export type StoredOwnerAgentBinding = {
	agentId: string;
	agentKey: string;
	ownerUserId: string;
	updatedAt: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureId(value: unknown, field: string): string {
	return assertRelayPrincipalId(value, field);
}

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

export class RelayOwnerBindingStore {
	private readonly filePath: string;

	constructor(filePath = getDefaultStorePath()) {
		this.filePath = filePath;
	}

	getFilePath(): string {
		return this.filePath;
	}

	countBindings(): number {
		return this.readBindings().length;
	}

	bindAgentToOwner(agentId: string, agentKey: string, ownerUserId: string): StoredOwnerAgentBinding {
		const binding: StoredOwnerAgentBinding = {
			agentId: ensureId(agentId, "agentId"),
			agentKey: ensureId(agentKey, "agentKey"),
			ownerUserId: ensureId(ownerUserId, "ownerUserId"),
			updatedAt: Date.now(),
		};

		const nextBindings = this.readBindings().filter((entry) => entry.agentId !== binding.agentId);
		nextBindings.push(binding);
		this.writeBindings(nextBindings);
		return binding;
	}

	findOwnerUserIdForAgent(agentId: string, agentKey: string): string | null {
		for (const binding of this.readBindings()) {
			if (binding.agentId === agentId && binding.agentKey === agentKey) {
				return binding.ownerUserId;
			}
		}

		return null;
	}

	findLatestAgentByOwnerUserId(ownerUserId: string): StoredOwnerAgentBinding | null {
		const normalizedOwnerUserId = ensureId(ownerUserId, "ownerUserId");
		for (const binding of this.readBindings()) {
			if (binding.ownerUserId === normalizedOwnerUserId) {
				return binding;
			}
		}

		return null;
	}

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

	private writeBindings(bindings: StoredOwnerAgentBinding[]) {
		mkdirSync(dirname(this.filePath), { recursive: true });

		const payload: OwnerBindingStoreFile = {
			agents: bindings,
		};

		writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}
}
