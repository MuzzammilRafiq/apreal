import {
	RELAY_CLIENT_AUTH_PATH,
	RELAY_AGENT_OWNER_GRANT_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	type RelayAgentOwnerGrantResponse,
	type RelayAuthTarget,
	type RelayClientAuthRequest,
	type RelayClientAuthResponse,
	type RelayClientHeartbeatRequest,
	type RelayClientHeartbeatResponse,
	type RemoteSettingsAuthorization,
	type RemoteSettingsSection,
} from "@apreal/shared";

const RELAY_CLIENT_AUTH_STORAGE_KEY = "pi-browser-relay-auth";
const RELAY_AUTH_REFRESH_WINDOW_MS = 60_000;
const authCache = new Map<string, StoredRelayClientAuth>();
let legacyRelayAuthRemoved = false;

export type StoredRelayClientAuth = {
	relayUrl: string;
	clientId: string;
	token: string;
	expiresAt: number;
	target: RelayAuthTarget | null;
	updatedAt: number;
};

export type RelayClientHeartbeatStatus = {
	auth: StoredRelayClientAuth;
	serverReady: boolean;
	transportReady: boolean;
	settingsAuthorization: RemoteSettingsAuthorization;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAgentOwnerGrantResponse(payload: unknown): RelayAgentOwnerGrantResponse {
	if (!isObjectRecord(payload) || typeof payload.ownerGrant !== "string" || typeof payload.expiresAt !== "number") {
		throw new Error("relay owner grant returned an invalid response");
	}

	return {
		ownerGrant: payload.ownerGrant,
		expiresAt: payload.expiresAt,
	};
}

function parseStoredTarget(value: unknown): RelayAuthTarget | null {
	if (!isObjectRecord(value)) {
		return null;
	}

	if (typeof value.id !== "string") {
		return null;
	}

	if (value.type !== "agent" && value.type !== "client") {
		return null;
	}

	return {
		id: value.id,
		type: value.type,
	};
}

function readStoredRelayClientAuth(relayUrl: string): StoredRelayClientAuth | null {
	return authCache.get(relayUrl) ?? null;
}

function writeStoredRelayClientAuth(auth: StoredRelayClientAuth) {
	authCache.set(auth.relayUrl, auth);
}

function isUsableRelayClientAuth(auth: StoredRelayClientAuth | null): auth is StoredRelayClientAuth {
	return Boolean(auth?.target && auth.token && auth.expiresAt > Date.now() + RELAY_AUTH_REFRESH_WINDOW_MS);
}

function removeLegacyRelayAuthStorage() {
	if (legacyRelayAuthRemoved) {
		return;
	}

	legacyRelayAuthRemoved = true;
	try {
		window.localStorage.removeItem(RELAY_CLIENT_AUTH_STORAGE_KEY);
	} catch {
		// Storage can be unavailable in hardened browser contexts.
	}
}

function parseClientAuthResponse(payload: unknown): RelayClientAuthResponse {
	if (!isObjectRecord(payload)) {
		throw new Error("relay client auth returned an invalid response");
	}

	const target = payload.target === null ? null : parseStoredTarget(payload.target);
	if (
		typeof payload.clientId !== "string" ||
		typeof payload.token !== "string" ||
		typeof payload.expiresAt !== "number" ||
		typeof payload.paired !== "boolean" ||
		(payload.target !== null && !target)
	) {
		throw new Error("relay client auth returned an invalid response");
	}

	return {
		clientId: payload.clientId,
		token: payload.token,
		expiresAt: payload.expiresAt,
		target,
		paired: payload.paired,
	};
}

function parseRemoteSettingsSection(value: unknown): RemoteSettingsSection | null {
	if (
		value === "account" ||
		value === "connection" ||
		value === "models" ||
		value === "skills" ||
		value === "mcp" ||
		value === "tools" ||
		value === "jobs"
	) {
		return value;
	}

	return null;
}

function parseSettingsAuthorization(payload: unknown): RemoteSettingsAuthorization {
	if (!isObjectRecord(payload) || !Array.isArray(payload.sections)) {
		return { sections: [] };
	}

	return {
		sections: payload.sections
			.map(parseRemoteSettingsSection)
			.filter((section): section is RemoteSettingsSection => section !== null),
	};
}

function parseClientHeartbeatResponse(payload: unknown): RelayClientHeartbeatResponse {
	if (!isObjectRecord(payload)) {
		throw new Error("relay heartbeat returned an invalid response");
	}

	const authResponse = parseClientAuthResponse(payload);
	if (typeof payload.serverReady !== "boolean" || typeof payload.transportReady !== "boolean") {
		throw new Error("relay heartbeat returned an invalid response");
	}

	return {
		...authResponse,
		serverReady: payload.serverReady,
		transportReady: payload.transportReady,
		settingsAuthorization: parseSettingsAuthorization(payload.settingsAuthorization),
	};
}

export async function ensureRelayClientAuth(relayUrl: string): Promise<StoredRelayClientAuth> {
	removeLegacyRelayAuthStorage();
	const cachedAuth = readStoredRelayClientAuth(relayUrl);
	if (isUsableRelayClientAuth(cachedAuth)) {
		return cachedAuth;
	}

	const requestBody: RelayClientAuthRequest = {};

	const response = await fetch(new URL(RELAY_CLIENT_AUTH_PATH, relayUrl), {
		method: "POST",
		credentials: "include",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(requestBody),
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
			: `relay client auth failed with status ${response.status}`;
		throw new Error(message);
	}

	const issuedAuth = parseClientAuthResponse(payload);
	const nextAuth: StoredRelayClientAuth = {
		relayUrl,
		clientId: issuedAuth.clientId,
		token: issuedAuth.token,
		expiresAt: issuedAuth.expiresAt,
		target: issuedAuth.target,
		updatedAt: Date.now(),
	};
	writeStoredRelayClientAuth(nextAuth);
	return nextAuth;
}

export async function requestRelayAgentOwnerGrant(relayUrl: string): Promise<RelayAgentOwnerGrantResponse> {
	const response = await fetch(new URL(RELAY_AGENT_OWNER_GRANT_PATH, relayUrl), {
		method: "POST",
		credentials: "include",
		headers: {
			accept: "application/json",
		},
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
			: `relay owner grant failed with status ${response.status}`;
		throw new Error(message);
	}

	return parseAgentOwnerGrantResponse(payload);
}

export async function readRelayClientHeartbeat(relayUrl: string): Promise<RelayClientHeartbeatStatus> {
	removeLegacyRelayAuthStorage();
	const requestBody: RelayClientHeartbeatRequest = {};

	const response = await fetch(new URL(RELAY_CLIENT_HEARTBEAT_PATH, relayUrl), {
		method: "POST",
		credentials: "include",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(requestBody),
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
			: `relay heartbeat failed with status ${response.status}`;
		throw new Error(message);
	}

	const heartbeat = parseClientHeartbeatResponse(payload);
	const nextAuth: StoredRelayClientAuth = {
		relayUrl,
		clientId: heartbeat.clientId,
		token: heartbeat.token,
		expiresAt: heartbeat.expiresAt,
		target: heartbeat.target,
		updatedAt: Date.now(),
	};
	writeStoredRelayClientAuth(nextAuth);
	return {
		auth: nextAuth,
		serverReady: heartbeat.serverReady,
		transportReady: heartbeat.transportReady,
		settingsAuthorization: heartbeat.settingsAuthorization,
	};
}
