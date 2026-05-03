import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	normalizeRelayPairingCode,
	RELAY_AGENT_AUTH_PATH,
	RELAY_CONNECTION_PATH,
	type RelayAgentAuthRequest,
	type RelayAgentAuthResponse,
	type RelayPrincipalType,
} from "@apreal/shared";

const PI_AGENT_RELAY_AUTH_PATH = join(homedir(), ".pi", "agent", "relay-auth.json");

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
	serverUrl: string | null;
	updatedAt: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredRelayAgentAuth(): StoredRelayAgentAuth | null {
	if (!existsSync(PI_AGENT_RELAY_AUTH_PATH)) {
		return null;
	}

	try {
		const content = readFileSync(PI_AGENT_RELAY_AUTH_PATH, "utf8");
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
			token: typeof parsed.token === "string" && parsed.token.trim() ? parsed.token.trim() : null,
			expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
			targetId: typeof parsed.targetId === "string" && parsed.targetId.trim() ? parsed.targetId.trim() : null,
			targetType:
				parsed.targetType === "agent" || parsed.targetType === "client" ? parsed.targetType : null,
			serverUrl: typeof parsed.serverUrl === "string" && parsed.serverUrl.trim() ? parsed.serverUrl.trim() : null,
			updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
		};
	} catch {
		return null;
	}
}

function writeStoredRelayAgentAuth(auth: StoredRelayAgentAuth) {
	mkdirSync(dirname(PI_AGENT_RELAY_AUTH_PATH), { recursive: true });
	writeFileSync(PI_AGENT_RELAY_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

function createAgentIdentity(existing: StoredRelayAgentAuth | null, relayUrl: string): StoredRelayAgentAuth {
	return {
		relayUrl,
		agentId: existing?.agentId ?? `agent-${crypto.randomUUID()}`,
		agentKey: existing?.agentKey ?? `key-${crypto.randomUUID()}`,
		token: existing?.token ?? null,
		expiresAt: existing?.expiresAt ?? null,
		targetId: existing?.targetId ?? null,
		targetType: existing?.targetType ?? null,
		updatedAt: Date.now(),
		serverUrl: null,
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

	if (!isObjectRecord(payload) || !isObjectRecord(payload.target)) {
		throw new Error("relay agent auth returned an invalid response");
	}

	const target = payload.target;
	if (
		typeof payload.agentId !== "string" ||
		typeof payload.agentKey !== "string" ||
		typeof payload.token !== "string" ||
		typeof payload.expiresAt !== "number" ||
		typeof target.id !== "string" ||
		(target.type !== "agent" && target.type !== "client")
	) {
		throw new Error("relay agent auth returned an invalid response");
	}

	return payload as RelayAgentAuthResponse;
}

export function getRelayServerUrl(): string {
	return process.env.PI_RELAY_URL?.trim() || "https://api.malikmuzzammilrafiq.store";
}

export async function ensureRelayAgentAuth(
	logger: LoggerLike,
	relayUrl = getRelayServerUrl(),
): Promise<StoredRelayAgentAuth> {
	const storedAuth = createAgentIdentity(readStoredRelayAgentAuth(), relayUrl);
	writeStoredRelayAgentAuth(storedAuth);

	if (storedAuth.token) {
		try {
			const refreshed = await requestAgentAuth(relayUrl, {
				agentId: storedAuth.agentId,
				agentKey: storedAuth.agentKey,
			});
			const nextAuth: StoredRelayAgentAuth = {
				...storedAuth,
				token: refreshed.token,
				expiresAt: refreshed.expiresAt,
				targetId: refreshed.target.id,
				targetType: refreshed.target.type,
				serverUrl: null,
				updatedAt: Date.now(),
			};
			writeStoredRelayAgentAuth(nextAuth);
			logger.info("restored relay agent auth", {
				agentId: nextAuth.agentId,
				targetId: nextAuth.targetId,
			});
			return nextAuth;
		} catch (error) {
			logger.warn("stored relay agent auth could not be reused", {
				agentId: storedAuth.agentId,
				error: getErrorMessage(error),
			});
		}
	}

	const pairingCode = normalizeRelayPairingCode(process.env.PI_RELAY_PAIRING_CODE);
	if (!pairingCode) {
		throw new Error("Relay pairing is not configured. Use the local settings page or set PI_RELAY_PAIRING_CODE.");
	}

	const issued = await requestAgentAuth(relayUrl, {
		agentId: storedAuth.agentId,
		agentKey: storedAuth.agentKey,
		pairingCode,
	});

	const nextAuth: StoredRelayAgentAuth = {
		...storedAuth,
		token: issued.token,
		expiresAt: issued.expiresAt,
		targetId: issued.target.id,
		targetType: issued.target.type,
		serverUrl: null,
		updatedAt: Date.now(),
	};
	writeStoredRelayAgentAuth(nextAuth);
	logger.info("stored relay agent auth", {
		agentId: nextAuth.agentId,
		targetId: nextAuth.targetId,
		path: PI_AGENT_RELAY_AUTH_PATH,
	});
	return nextAuth;
}

export async function reauthenticateRelayAgent(
	logger: LoggerLike,
	pairingCode: string,
	relayUrl = getRelayServerUrl(),
): Promise<StoredRelayAgentAuth> {
	const storedAuth = createAgentIdentity(readStoredRelayAgentAuth(), relayUrl);
	const normalizedPairingCode = normalizeRelayPairingCode(pairingCode);
	if (!normalizedPairingCode) {
		throw new Error("Authentication code is required.");
	}

	const issued = await requestAgentAuth(relayUrl, {
		agentId: storedAuth.agentId,
		agentKey: storedAuth.agentKey,
		pairingCode: normalizedPairingCode,
	});

	const nextAuth: StoredRelayAgentAuth = {
		...storedAuth,
		token: issued.token,
		expiresAt: issued.expiresAt,
		targetId: issued.target.id,
		targetType: issued.target.type,
		serverUrl: null,
		updatedAt: Date.now(),
	};
	writeStoredRelayAgentAuth(nextAuth);
	logger.info("re-authenticated relay agent", {
		agentId: nextAuth.agentId,
		targetId: nextAuth.targetId,
		path: PI_AGENT_RELAY_AUTH_PATH,
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
