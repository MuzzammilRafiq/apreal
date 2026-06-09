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
import type { AuthTokenPayload, IssuedRelayToken } from "../auth.ts";
import { hasRelayJwtSecret } from "../env.ts";
import { RelayOwnerBindingStore } from "../owner-binding-store.ts";
import type { RelayAgentConnection } from "../utils/types.ts";

function resolveTargetFromPayload(payload: IssuedRelayToken["payload"]): RelayPrincipalType {
	return payload.type === "client" ? "agent" : "client";
}

export function buildHealthPayload(corsHeaders: Record<string, string>, ownerBindingStore: RelayOwnerBindingStore) {
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
			ownerBindingCount: ownerBindingStore.countBindings(),
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

export function buildClientAuthResponse(entry: IssuedRelayToken): RelayClientAuthResponse {
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

function hasActiveAgentSession(agentSessions: Map<string, AuthTokenPayload>, agentId: string): boolean {
	const session = agentSessions.get(agentId);
	if (!session) {
		return false;
	}

	if (session.exp * 1000 <= Date.now()) {
		agentSessions.delete(agentId);
		return false;
	}

	return true;
}

export function buildClientHeartbeatResponse(
	entry: IssuedRelayToken,
	agentSessions: Map<string, AuthTokenPayload>,
	agentConnections: Map<string, RelayAgentConnection>,
): RelayClientHeartbeatResponse {
	const targetId = entry.payload.targetId ?? null;
	const serverReady = Boolean(targetId && hasActiveAgentSession(agentSessions, targetId));
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

export function buildAgentAuthResponse(entry: IssuedRelayToken): RelayAgentAuthResponse {
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
