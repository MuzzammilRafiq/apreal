import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	RELAY_AGENT_AUTH_PATH,
	RELAY_CONNECTION_PATH,
	PI_RELAY_URL,
	type RelayAgentAuthRequest,
	type RelayAgentAuthResponse,
	type RelayPrincipalType,
} from "@apreal/shared";
import { getAprealAgentPath } from "../agent-dir.ts";

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

type AgentIdentity = {
	relayUrl: string;
	agentId: string;
	agentKey: string;
	updatedAt: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getORCreateAgentIdentity(): AgentIdentity {
	try {
		const parsed: unknown = JSON.parse(readFileSync(APREAL_AGENT_RELAY_AUTH_PATH, "utf8"));
		if (isObjectRecord(parsed) && typeof parsed.agentId === "string" && typeof parsed.agentKey === "string") {
			const [agentId, agentKey] = [parsed.agentId.trim(), parsed.agentKey.trim()];
			if (agentId && agentKey) {
				return {
					relayUrl: typeof parsed.relayUrl === "string" ? parsed.relayUrl.trim() : "",
					agentId,
					agentKey,
					updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
				};
			}
		}
	} catch {
		// A missing or malformed stored identity is replaced below.
	}

	return {
		relayUrl: PI_RELAY_URL,
		agentId: `agent-${crypto.randomUUID()}`,
		agentKey: `key-${crypto.randomUUID()}`,
		updatedAt: Date.now(),
	};
}

function writeAgentIdentity(identity: AgentIdentity) {
	// 0o700 => only the current user can access it.
	// 0o600 => only the current user can read or modify it.
	const authDirectory = dirname(APREAL_AGENT_RELAY_AUTH_PATH);
	mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
	chmodSync(authDirectory, 0o700);
	writeFileSync(APREAL_AGENT_RELAY_AUTH_PATH, `${JSON.stringify(identity, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	chmodSync(APREAL_AGENT_RELAY_AUTH_PATH, 0o600);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

async function requestAgentAuth(request: RelayAgentAuthRequest): Promise<RelayAgentAuthResponse> {
	const response = await fetch(new URL(RELAY_AGENT_AUTH_PATH, PI_RELAY_URL), {
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


export async function ensureAgentAuth(logger: LoggerLike): Promise<StoredRelayAgentAuth> {
	const identity = getORCreateAgentIdentity();
	writeAgentIdentity(identity);

	try {
		const issued = await requestAgentAuth({
			agentId: identity.agentId,
			agentKey: identity.agentKey,
		});
		const nextAuth: StoredRelayAgentAuth = {
			...identity,
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
			agentId: identity.agentId,
			error: getErrorMessage(error),
		});
	}
	throw new Error("Relay agent is not authenticated. Sign in locally to link this server to your Google account.");
}

export async function authenticateRelayAgentWithOwnerGrant(
	logger: LoggerLike,
	ownerGrant: string,
): Promise<StoredRelayAgentAuth> {
	const storedIdentity = getORCreateAgentIdentity();
	if (!ownerGrant.trim()) {
		throw new Error("Owner grant is required.");
	}

	const issued = await requestAgentAuth({
		agentId: storedIdentity.agentId,
		agentKey: storedIdentity.agentKey,
		ownerGrant,
		rotateCredential: true,
	});

	const rotatedIdentity = { ...storedIdentity, agentKey: issued.agentKey, updatedAt: Date.now() };
	writeAgentIdentity(rotatedIdentity);
	const nextAuth: StoredRelayAgentAuth = {
		...rotatedIdentity,
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
