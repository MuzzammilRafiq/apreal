import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	RELAY_AGENT_AUTH_PATH,
	RELAY_CONNECTION_PATH,
	type RelayAgentAuthRequest,
	type RelayAgentAuthResponse,
	type RelayPrincipalType,
} from "@apreal/shared";
import { getAprealAgentPath } from "./agent-dir.ts";
import { getServerEnv } from "./env.ts";

const APREAL_AGENT_RELAY_AUTH_PATH = getAprealAgentPath("relay-auth.json");

type LoggerLike = {
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
};

export type StoredRelayAgentAuth = {
	relayUrl: string;
	agentId: string;
	agentKey: string;
	token: string | null;
	expiresAt: number | null;
	targetId: string | null;
	targetType: RelayPrincipalType | null;
	updatedAt: number;
};

type StoredRelayAgentIdentity = {
	relayUrl: string;
	agentId: string;
	agentKey: string;
	updatedAt: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredRelayAgentIdentity(): StoredRelayAgentIdentity | null {
	if (!existsSync(APREAL_AGENT_RELAY_AUTH_PATH)) {
		return null;
	}

	try {
		const content = readFileSync(APREAL_AGENT_RELAY_AUTH_PATH, "utf8");
		const parsed: unknown = JSON.parse(content);
		if (!isObjectRecord(parsed)) {
			return null;
		}

		const agentId = typeof parsed.agentId === "string" ? parsed.agentId.trim() : "";
		const agentKey = typeof parsed.agentKey === "string" ? parsed.agentKey.trim() : "";
		if (!agentId || !agentKey) {
			return null;
		}

		return {
			relayUrl: typeof parsed.relayUrl === "string" && parsed.relayUrl.trim() ? parsed.relayUrl.trim() : "",
			agentId,
			agentKey,
			updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
		};
	} catch {
		return null;
	}
}

function writeStoredRelayAgentIdentity(identity: StoredRelayAgentIdentity) {
	const authDirectory = dirname(APREAL_AGENT_RELAY_AUTH_PATH);
	mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
	chmodSync(authDirectory, 0o700);
	writeFileSync(APREAL_AGENT_RELAY_AUTH_PATH, `${JSON.stringify(identity, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	chmodSync(APREAL_AGENT_RELAY_AUTH_PATH, 0o600);
}

function createAgentIdentity(existing: StoredRelayAgentIdentity | null, relayUrl: string): StoredRelayAgentIdentity {
	return {
		relayUrl,
		agentId: existing?.agentId ?? `agent-${crypto.randomUUID()}`,
		agentKey: existing?.agentKey ?? `key-${crypto.randomUUID()}`,
		updatedAt: Date.now(),
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

async function requestAgentAuth(relayUrl: string, request: RelayAgentAuthRequest): Promise<RelayAgentAuthResponse> {
	const response = await fetch(new URL(RELAY_AGENT_AUTH_PATH, relayUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
	});

	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		// Ignore malformed bodies and use the status fallback below.
	}

	if (!response.ok) {
		const message = isObjectRecord(payload) && typeof payload.message === "string"
			? payload.message
			: `relay agent auth failed with status ${response.status}`;
		throw new Error(message);
	}

	if (!isObjectRecord(payload) || (payload.target !== null && !isObjectRecord(payload.target))) {
		throw new Error("relay agent auth returned an invalid response");
	}

	const target = payload.target;
	if (
		typeof payload.agentId !== "string" ||
		typeof payload.agentKey !== "string" ||
		typeof payload.token !== "string" ||
		typeof payload.expiresAt !== "number" ||
		typeof payload.paired !== "boolean" ||
		(target !== null && (
			typeof target.id !== "string" ||
			(target.type !== "agent" && target.type !== "client")
		))
	) {
		throw new Error("relay agent auth returned an invalid response");
	}

	return payload as RelayAgentAuthResponse;
}

export function getRelayServerUrl(): string {
	return getServerEnv().PI_RELAY_URL || "https://api.malikmuzzammilrafiq.store";
}

export async function ensureRelayAgentAuth(
	logger: LoggerLike,
	relayUrl = getRelayServerUrl(),
): Promise<StoredRelayAgentAuth> {
	const storedIdentity = createAgentIdentity(readStoredRelayAgentIdentity(), relayUrl);
	writeStoredRelayAgentIdentity(storedIdentity);

	try {
		const issued = await requestAgentAuth(relayUrl, {
			agentId: storedIdentity.agentId,
			agentKey: storedIdentity.agentKey,
		});
		const nextAuth: StoredRelayAgentAuth = {
			...storedIdentity,
			token: issued.token,
			expiresAt: issued.expiresAt,
			targetId: issued.target?.id ?? null,
			targetType: issued.target?.type ?? null,
			updatedAt: Date.now(),
		};
		logger.info("restored relay agent auth", {
			agentId: nextAuth.agentId,
			targetId: nextAuth.targetId,
		});
		return nextAuth;
	} catch (error) {
		logger.warn("stored relay agent identity could not be authenticated", {
			agentId: storedIdentity.agentId,
			error: getErrorMessage(error),
		});
	}

	throw new Error("Relay agent is not authenticated. Sign in locally to link this server to your Google account.");
}

export async function authenticateRelayAgentWithOwnerGrant(
	logger: LoggerLike,
	ownerGrant: string,
	relayUrl = getRelayServerUrl(),
): Promise<StoredRelayAgentAuth> {
	const storedIdentity = createAgentIdentity(readStoredRelayAgentIdentity(), relayUrl);
	if (!ownerGrant.trim()) {
		throw new Error("Owner grant is required.");
	}

	const issued = await requestAgentAuth(relayUrl, {
		agentId: storedIdentity.agentId,
		agentKey: storedIdentity.agentKey,
		ownerGrant,
	});

	writeStoredRelayAgentIdentity(storedIdentity);
	const nextAuth: StoredRelayAgentAuth = {
		...storedIdentity,
		token: issued.token,
		expiresAt: issued.expiresAt,
		targetId: issued.target?.id ?? null,
		targetType: issued.target?.type ?? null,
		updatedAt: Date.now(),
	};
	logger.info("authenticated relay agent with owner grant", {
		agentId: nextAuth.agentId,
		path: APREAL_AGENT_RELAY_AUTH_PATH,
	});
	return nextAuth;
}

export function readClientTokenFromRequest(request: Request): string | null {
	const authorizationHeader = request.headers.get("authorization");
	if (authorizationHeader) {
		const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
		if (match?.[1]) {
			return match[1];
		}
	}

	const url = new URL(request.url);
	const queryToken = url.searchParams.get("token")?.trim();
	return queryToken || null;
}

export async function verifyRelayClientAccess(relayUrl: string, clientToken: string, agentId: string) {
	const response = await fetch(new URL(RELAY_CONNECTION_PATH, relayUrl), {
		method: "POST",
		headers: {
			authorization: `Bearer ${clientToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			targetId: agentId,
			targetType: "agent",
		}),
	});

	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		// Ignore malformed bodies and use the status fallback below.
	}

	if (!response.ok) {
		const message = isObjectRecord(payload) && typeof payload.message === "string"
			? payload.message
			: `relay connection check failed with status ${response.status}`;
		throw new Error(message);
	}

	if (!isObjectRecord(payload) || !isObjectRecord(payload.principal)) {
		throw new Error("relay connection check returned an invalid response");
	}

	const principal = payload.principal;
	if (typeof principal.id !== "string") {
		throw new Error("relay connection check returned an invalid response");
	}

	return {
		clientId: principal.id,
	};
}
