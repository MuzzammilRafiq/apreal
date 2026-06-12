import type { IncomingMessage, ServerResponse } from "node:http";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_AUTH_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_OWNER_GRANT_PATH,
	RELAY_AGENT_STREAM_PATH,
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	RELAY_CONNECTION_PATH,
} from "@apreal/shared";
import {
	AuthError,
	generateOwnerAgentGrant,
	issueRelayToken,
	readBearerTokenFromRequest,
	readOwnerAgentGrant,
	readRelayToken,
	type IssuedRelayToken,
} from "../auth.ts";
import {
	ensureBetterAuthReady,
	getBetterAuthHandler,
	isBetterAuthConfigured,
	readBetterAuthUserId,
} from "../better-auth.ts";
import type { RelayServerState } from "./state.ts";
import { createRelayTransportHandlers } from "./transports.ts";
import {
	authorizeRelayConnection,
	mapRelayConnectionErrorStatus,
	mapRelayProxyErrorStatus,
} from "./authorization.ts";
import { createCorsHeaders } from "./cors.ts";
import { getErrorMessage, sendJson, sendText, setHeaders } from "./http.ts";
import { parseAgentAuthRequest, parseClientAuthRequest, parseRelayConnectionRequest } from "./parsing.ts";
import { buildAgentAuthResponse, buildClientAuthResponse, buildClientHeartbeatResponse, buildHealthPayload } from "./responses.ts";
import { log } from "../utils/log.ts";

// Completes a CORS preflight request for any relay endpoint.
function endPreflight(response: ServerResponse, corsHeaders: Record<string, string>) {
	response.statusCode = 204;
	setHeaders(response, corsHeaders);
	response.end();
}

// Enforces the expected HTTP method for a route and handles OPTIONS centrally.
function requireMethod(
	request: IncomingMessage,
	response: ServerResponse,
	corsHeaders: Record<string, string>,
	method: string,
): boolean {
	if (request.method === "OPTIONS") {
		endPreflight(response, corsHeaders);
		return false;
	}

	if (request.method !== method) {
		sendText(response, 405, "Method Not Allowed", corsHeaders);
		return false;
	}

	return true;
}

// Creates the top-level HTTP request router for the relay server.
export function createRelayRequestHandler(state: RelayServerState) {
	const transports = createRelayTransportHandlers(state);

	// Reads the signed-in Better Auth owner id when auth is enabled, and fails
	// if a protected route requires a session but none is present.
	async function readRequiredOwnerUserId(request: IncomingMessage): Promise<string | undefined> {
		const ownerUserId = await readBetterAuthUserId(request);
		if (!isBetterAuthConfigured()) {
			return undefined;
		}

		if (!ownerUserId) {
			throw new AuthError("signed-in user session is required");
		}

		return ownerUserId;
	}

	// Issues a browser token and, when possible, pre-pairs it to the owner's
	// most recently bound agent.
	function issueClientToken(
		clientId: string,
		clientKey: string,
		ownerUserId: string | undefined,
	): IssuedRelayToken {
		const ownerAgent = ownerUserId
			? state.ownerBindingStore.findLatestAgentByOwnerUserId(ownerUserId)
			: null;

		return issueRelayToken({
			type: "client",
			id: clientId,
			key: clientKey,
			targetId: ownerAgent?.agentId,
			targetType: ownerAgent ? "agent" : undefined,
			ownerUserId,
		});
	}

	// Issues an agent token and records its active session payload in memory so
	// heartbeat responses can report agent readiness.
	function issueAgentToken(
		agentId: string,
		agentKey: string,
		ownerUserId: string,
	): IssuedRelayToken {
		for (const [sessionAgentId, session] of Array.from(state.agentSessions.entries())) {
			if (session.ownerUserId === ownerUserId && sessionAgentId !== agentId) {
				state.agentSessions.delete(sessionAgentId);
			}
		}
		transports.closeAgentConnectionsForOwner(ownerUserId, agentId, "agent_owner_session_replaced");

		const issuedToken = issueRelayToken({
			type: "agent",
			id: agentId,
			key: agentKey,
			ownerUserId,
		});
		state.agentSessions.set(agentId, issuedToken.payload);
		return issuedToken;
	}

	// Handles every incoming relay HTTP request, dispatching to auth, health,
	// transport, and authorization endpoints.
	return async (request: IncomingMessage, response: ServerResponse) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders(request);

		// Better Auth owns its own sub-router once the relay has ensured its
		// migrations and handler are ready.
		if (pathname.startsWith("/api/auth/")) {
			if (request.method === "OPTIONS") {
				endPreflight(response, corsHeaders);
				return;
			}

			setHeaders(response, corsHeaders);
			try {
				await ensureBetterAuthReady();
				getBetterAuthHandler()(request, response);
			} catch (error) {
				const message = getErrorMessage(error);
				log("warn", "better auth unavailable", { error: message });
				sendJson(response, 503, { message }, corsHeaders);
			}
			return;
		}

		// Lightweight liveness and configuration introspection endpoint.
		if (pathname === "/" || pathname === "/health") {
			sendJson(response, 200, buildHealthPayload(corsHeaders, state.ownerBindingStore), corsHeaders);
			return;
		}

		// Browser token issuance for hosted clients.
		if (pathname === RELAY_CLIENT_AUTH_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			const clientAuthRequest = await parseClientAuthRequest(request);
			if (!clientAuthRequest) {
				sendJson(response, 400, { message: "Invalid client auth request." }, corsHeaders);
				return;
			}

			try {
				const ownerGrantUserId = clientAuthRequest.ownerGrant
					? readOwnerAgentGrant(clientAuthRequest.ownerGrant).ownerUserId
					: undefined;
				const ownerUserId = ownerGrantUserId ?? await readRequiredOwnerUserId(request);
				const issuedToken = issueClientToken(
					clientAuthRequest.clientId,
					clientAuthRequest.clientKey,
					ownerUserId,
				);
				if (ownerUserId) {
					state.activeClientIdsByOwner.set(ownerUserId, issuedToken.payload.id);
					transports.closeBrowserClientsForOwner(
						ownerUserId,
						issuedToken.payload.id,
						"browser_owner_session_replaced",
					);
				}

				log("info", "issued client auth token", {
					clientId: issuedToken.payload.id,
					paired: Boolean(issuedToken.payload.targetId),
				});
				sendJson(response, 200, buildClientAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "client auth failed";
				log("warn", "client auth failed", { error: message });
				sendJson(response, error instanceof AuthError ? 401 : 500, { message }, corsHeaders);
			}
			return;
		}

		// Browser heartbeat re-issues/refreshes the client token and reports
		// whether the paired agent session and transport are live.
		if (pathname === RELAY_CLIENT_HEARTBEAT_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			const clientHeartbeatRequest = await parseClientAuthRequest(request);
			if (!clientHeartbeatRequest) {
				sendJson(response, 400, { message: "Invalid relay heartbeat request." }, corsHeaders);
				return;
			}

			try {
				const ownerGrantUserId = clientHeartbeatRequest.ownerGrant
					? readOwnerAgentGrant(clientHeartbeatRequest.ownerGrant).ownerUserId
					: undefined;
				const ownerUserId = ownerGrantUserId ?? await readRequiredOwnerUserId(request);
				const issuedToken = issueClientToken(
					clientHeartbeatRequest.clientId,
					clientHeartbeatRequest.clientKey,
					ownerUserId,
				);

				sendJson(
					response,
					200,
					buildClientHeartbeatResponse(issuedToken, state.agentSessions, state.agentConnections),
					corsHeaders,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : "relay heartbeat failed";
				log("warn", "relay heartbeat failed", { error: message });
				sendJson(response, error instanceof AuthError ? 401 : 500, { message }, corsHeaders);
			}
			return;
		}

		// Generates the short-lived owner grant that a local agent/client can use
		// to bind itself to the signed-in owner.
		if (pathname === RELAY_AGENT_OWNER_GRANT_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			try {
				const ownerUserId = await readRequiredOwnerUserId(request);
				if (!ownerUserId) {
					throw new AuthError("signed-in user session is required");
				}

				sendJson(response, 200, generateOwnerAgentGrant(ownerUserId), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "agent owner grant failed";
				log("warn", "agent owner grant failed", { error: message });
				sendJson(response, error instanceof AuthError ? 401 : 500, { message }, corsHeaders);
			}
			return;
		}

		// Agent token issuance, either from a fresh owner grant or a previously
		// persisted owner-agent binding.
		if (pathname === RELAY_AGENT_AUTH_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			const agentAuthRequest = await parseAgentAuthRequest(request);
			if (!agentAuthRequest) {
				sendJson(response, 400, { message: "Invalid agent auth request." }, corsHeaders);
				return;
			}

			try {
				const ownerGrantUserId = agentAuthRequest.ownerGrant
					? readOwnerAgentGrant(agentAuthRequest.ownerGrant).ownerUserId
					: undefined;
				const ownerUserId = ownerGrantUserId
					?? state.ownerBindingStore.findOwnerUserIdForAgent(agentAuthRequest.agentId, agentAuthRequest.agentKey);
				if (!ownerUserId) {
					sendJson(response, 400, { message: "Sign in locally to authenticate the relay agent." }, corsHeaders);
					return;
				}
				if (ownerGrantUserId) {
					state.ownerBindingStore.bindAgentToOwner(
						agentAuthRequest.agentId,
						agentAuthRequest.agentKey,
						ownerGrantUserId,
					);
				}
				const issuedToken = issueAgentToken(agentAuthRequest.agentId, agentAuthRequest.agentKey, ownerUserId);

				log("info", "issued agent auth token", {
					agentId: issuedToken.payload.id,
					targetId: issuedToken.payload.targetId,
					connected: Boolean(state.agentConnections.get(issuedToken.payload.id)),
				});
				sendJson(response, 200, buildAgentAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "agent auth failed";
				log("warn", "agent auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		// Long-lived SSE stream from relay to agent commands.
		if (pathname === RELAY_AGENT_STREAM_PATH) {
			if (!requireMethod(request, response, corsHeaders, "GET")) {
				return;
			}

			try {
				transports.handleAgentStreamRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may open relay agent transport" ? 403 : 401;
				log("warn", "relay agent stream rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		// Agent-to-browser message delivery endpoint.
		if (pathname === RELAY_AGENT_MESSAGE_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			try {
				await transports.handleAgentMessageRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may post relay agent messages" ? 403 : 401;
				log("warn", "relay agent message rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		// Long-lived SSE stream from relay to browser events.
		if (pathname === CLIENT_EVENT_STREAM_PATH) {
			if (!requireMethod(request, response, corsHeaders, "GET")) {
				return;
			}

			try {
				transports.registerBrowserClientStream(request, response, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay stream request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		// Browser-to-agent message delivery endpoint.
		if (pathname === CLIENT_MESSAGE_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			try {
				await transports.handleClientMessageRequest(request, response, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay message request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		// HTTP-only authorization check used by callers that want to validate a
		// token against a specific target without opening a stream.
		if (pathname === RELAY_CONNECTION_PATH) {
			if (!requireMethod(request, response, corsHeaders, "POST")) {
				return;
			}

			const connectionRequest = await parseRelayConnectionRequest(request);
			if (!connectionRequest) {
				sendJson(response, 400, { message: "Invalid relay connection request." }, corsHeaders);
				return;
			}

			try {
				const token = readBearerTokenFromRequest(request);
				const principal = readRelayToken(token);
				const payload = authorizeRelayConnection(principal, connectionRequest);
				log("info", "authenticated relay http connection", {
					principalId: payload.principal.id,
					principalType: payload.principal.type,
					targetId: payload.target.id,
					targetType: payload.target.type,
					scopedToTarget: payload.principal.scopedToTarget,
				});
				sendJson(response, 200, payload, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayConnectionErrorStatus(error);
				const message = error instanceof Error ? error.message : "relay connection authorization failed";
				log("warn", "relay http connection rejected", {
					error: message,
				});
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		// Everything else is outside the relay API surface.
		sendText(response, 404, "Not Found", corsHeaders);
	};
}
