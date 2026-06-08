import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_AUTH_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	RELAY_CONNECTION_PATH,
	type RelayAgentAuthResponse,
	type RelayClientAuthResponse,
	type RelayClientHeartbeatResponse,
	type RelayPrincipalType,
} from "@apreal/shared";
import { hasRelayJwtSecret } from "../env.ts";
import type { StoredRelayToken } from "../token-store.ts";
import { RelayTokenStore } from "../token-store.ts";
import type { RelayAgentConnection } from "../utils/types.ts";

function resolveTargetFromPayload(payload: StoredRelayToken["payload"]): RelayPrincipalType {
	return payload.type === "client" ? "agent" : "client";
}

export function buildHealthPayload(corsHeaders: Record<string, string>, tokenStore: RelayTokenStore) {
	return {
		ok: true,
		service: "relay-server",
		transport: "http",
		timestamp: new Date().toISOString(),
		auth: {
			jwtSecretConfigured: hasRelayJwtSecret(),
			corsAllowOrigin: corsHeaders["access-control-allow-origin"],
		},
		storage: {
			tokenStorePath: tokenStore.getFilePath(),
			tokenCount: tokenStore.countTokens({ allowExpired: true }),
			activeTokenCount: tokenStore.countTokens({ allowExpired: false }),
		},
		endpoints: {
			base: "/",
			health: "/health",
			clientHeartbeat: RELAY_CLIENT_HEARTBEAT_PATH,
			clientStream: CLIENT_EVENT_STREAM_PATH,
			clientMessage: CLIENT_MESSAGE_PATH,
			clientAuth: RELAY_CLIENT_AUTH_PATH,
			agentAuth: RELAY_AGENT_AUTH_PATH,
			agentStream: RELAY_AGENT_STREAM_PATH,
			agentMessage: RELAY_AGENT_MESSAGE_PATH,
			connection: RELAY_CONNECTION_PATH,
		},
	};
}

export function buildClientAuthResponse(entry: StoredRelayToken): RelayClientAuthResponse {
	return {
		clientId: entry.payload.id,
		clientKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		target: entry.payload.targetId
			? {
				id: entry.payload.targetId,
				type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
			}
			: null,
		paired: Boolean(entry.payload.targetId),
	};
}

export function buildClientHeartbeatResponse(
	entry: StoredRelayToken,
	tokenStore: RelayTokenStore,
	agentConnections: Map<string, RelayAgentConnection>,
): RelayClientHeartbeatResponse {
	const targetId = entry.payload.targetId ?? null;
	const serverReady = Boolean(
		targetId && tokenStore.findLatestByPrincipalId("agent", targetId, { allowExpired: false }),
	);
	const transportReady = Boolean(targetId && agentConnections.get(targetId) && !agentConnections.get(targetId)?.closed);

	return {
		...buildClientAuthResponse(entry),
		serverReady,
		transportReady,
		settingsAuthorization: {
			sections: ["account"],
		},
	};
}

export function buildAgentAuthResponse(entry: StoredRelayToken): RelayAgentAuthResponse {
	return {
		agentId: entry.payload.id,
		agentKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		target: entry.payload.targetId
			? {
				id: entry.payload.targetId,
				type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
			}
			: null,
		paired: Boolean(entry.payload.targetId || entry.payload.ownerUserId),
	};
}
