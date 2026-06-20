import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { assertRelayPrincipalId, type RelayPrincipalType } from "@apreal/shared";

import { getRelayEnv } from "./env.ts";

export type RelayCredential = {
	credentialId: string;
	type: RelayPrincipalType;
	principalId: string;
	ownerUserId: string;
	createdAt: number;
	updatedAt: number;
	revokedAt: number | null;
};

type CredentialStoreFile = {
	credentials: RelayCredential[];
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureId(value: unknown, field: string): string {
	return assertRelayPrincipalId(value, field);
}

function getDefaultStorePath(): string {
	const env = getRelayEnv();
	if (env.RELAY_CREDENTIAL_STORE_PATH) {
		return resolve(env.RELAY_CREDENTIAL_STORE_PATH);
	}

	const bindingPath = env.RELAY_OWNER_BINDING_STORE_PATH ?? env.RELAY_TOKEN_STORE_PATH;
	if (bindingPath) {
		return resolve(dirname(resolve(bindingPath)), "relay-credentials.json");
	}

	if (env.RELAY_SQLITE_PATH) {
		return resolve(dirname(resolve(env.RELAY_SQLITE_PATH)), "relay-credentials.json");
	}

	return resolve(process.cwd(), ".data", "relay-credentials.json");
}

function parseCredential(value: unknown): RelayCredential | null {
	if (!isObjectRecord(value) || (value.type !== "agent" && value.type !== "client")) {
		return null;
	}

	try {
		const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
			? value.createdAt
			: Date.now();
		return {
			credentialId: ensureId(value.credentialId, "credentialId"),
			type: value.type,
			principalId: ensureId(value.principalId, "principalId"),
			ownerUserId: ensureId(value.ownerUserId, "ownerUserId"),
			createdAt,
			updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: createdAt,
			revokedAt: value.revokedAt === null
				? null
				: typeof value.revokedAt === "number" && Number.isFinite(value.revokedAt)
					? value.revokedAt
					: null,
		};
	} catch {
		return null;
	}
}

// Durable allow-list for relay credentials. JWT signatures prove a token was
// issued by the relay; this store additionally proves its individual browser
// or agent credential has not subsequently been revoked.
export class RelayCredentialStore {
	constructor(private readonly filePath = getDefaultStorePath()) {}

	getFilePath(): string {
		return this.filePath;
	}

	countActive(): number {
		return this.readCredentials().filter((credential) => credential.revokedAt === null).length;
	}

	create(type: RelayPrincipalType, principalId: string, ownerUserId: string): RelayCredential {
		const now = Date.now();
		const credential: RelayCredential = {
			credentialId: `credential-${randomUUID()}`,
			type,
			principalId: ensureId(principalId, "principalId"),
			ownerUserId: ensureId(ownerUserId, "ownerUserId"),
			createdAt: now,
			updatedAt: now,
			revokedAt: null,
		};
		const credentials = this.readCredentials();
		credentials.push(credential);
		this.writeCredentials(credentials);
		return credential;
	}

	get(credentialId: string): RelayCredential | null {
		const normalizedId = ensureId(credentialId, "credentialId");
		return this.readCredentials().find((credential) => credential.credentialId === normalizedId) ?? null;
	}

	assertActive(credentialId: string, type: RelayPrincipalType, principalId: string): RelayCredential {
		const credential = this.get(credentialId);
		if (!credential || credential.revokedAt !== null) {
			throw new Error("relay credential is revoked");
		}
		if (credential.type !== type || credential.principalId !== principalId) {
			throw new Error("relay credential does not match token principal");
		}
		return credential;
	}

	listForOwner(ownerUserId: string): RelayCredential[] {
		const normalizedOwnerId = ensureId(ownerUserId, "ownerUserId");
		return this.readCredentials()
			.filter((credential) => credential.ownerUserId === normalizedOwnerId)
			.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	revoke(credentialId: string, ownerUserId: string): RelayCredential | null {
		const normalizedCredentialId = ensureId(credentialId, "credentialId");
		const normalizedOwnerId = ensureId(ownerUserId, "ownerUserId");
		const credentials = this.readCredentials();
		const credential = credentials.find((entry) => entry.credentialId === normalizedCredentialId);
		if (!credential || credential.ownerUserId !== normalizedOwnerId) {
			return null;
		}
		if (credential.revokedAt === null) {
			credential.revokedAt = Date.now();
			credential.updatedAt = credential.revokedAt;
			this.writeCredentials(credentials);
		}
		return credential;
	}

	private readCredentials(): RelayCredential[] {
		if (!existsSync(this.filePath)) {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
			if (!isObjectRecord(parsed) || !Array.isArray(parsed.credentials)) {
				return [];
			}
			return parsed.credentials.map(parseCredential).filter((value): value is RelayCredential => value !== null);
		} catch {
			return [];
		}
	}

	private writeCredentials(credentials: RelayCredential[]) {
		const directory = dirname(this.filePath);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		const payload: CredentialStoreFile = { credentials };
		writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		chmodSync(this.filePath, 0o600);
	}
}
