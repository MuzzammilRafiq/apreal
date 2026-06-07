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
	readBearerTokenFromRequest,
	readOwnerAgentGrant,
	readRelayToken,
} from "../auth.ts";
import {
	ensureBetterAuthReady,
	getBetterAuthHandler,
	isBetterAuthConfigured,
	readBetterAuthUserId,
} from "../better-auth.ts";
import type { StoredRelayToken } from "../token-store.ts";
import type { RelayServerState } from "./state.ts";
import { createRelayTransportHandlers } from "./transports.ts";
import {
	authorizeRelayConnection,
	mapRelayConnectionErrorStatus,
	mapRelayProxyErrorStatus,
	shouldRefreshToken,
} from "./authorization.ts";
import { createCorsHeaders } from "./cors.ts";
import { getErrorMessage, sendJson, sendText, setHeaders } from "./http.ts";
import { parseAgentAuthRequest, parseClientAuthRequest, parseRelayConnectionRequest } from "./parsing.ts";
import { buildAgentAuthResponse, buildClientAuthResponse, buildClientHeartbeatResponse, buildHealthPayload } from "./responses.ts";
import { log } from "../utils/log.ts";

function endPreflight(response: ServerResponse, corsHeaders: Record<string, string>) {
	response.statusCode = 204;
	setHeaders(response, corsHeaders);
	response.end();
}

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

export function createRelayRequestHandler(state: RelayServerState) {
	const transports = createRelayTransportHandlers(state);

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

	function pairClientToOwnerAgentIfAvailable(entry: StoredRelayToken, ownerUserId: string | undefined): StoredRelayToken {
		if (!entry || !ownerUserId || entry.payload.targetId) {
			return entry;
		}

		const ownerAgent = state.tokenStore.findLatestAgentByOwnerUserId(ownerUserId, { allowExpired: false });
		if (!ownerAgent) {
			return entry;
		}

		return state.tokenStore.issueToken({
			type: "client",
			id: entry.payload.id,
			key: entry.payload.key,
			targetId: ownerAgent.payload.id,
			targetType: "agent",
			ownerUserId,
		});
	}

	return async (request: IncomingMessage, response: ServerResponse) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders(request);

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

		if (pathname === "/" || pathname === "/health") {
			sendJson(response, 200, buildHealthPayload(corsHeaders, state.tokenStore), corsHeaders);
			return;
		}

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
				let issuedToken = state.tokenStore.findLatestByPrincipal(
					"client",
					clientAuthRequest.clientId,
					clientAuthRequest.clientKey,
					{ allowExpired: true },
				);
				if (ownerUserId && issuedToken?.payload.ownerUserId !== ownerUserId) {
					issuedToken = null;
				}
				if (issuedToken && shouldRefreshToken(issuedToken)) {
					issuedToken = state.tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
						ownerUserId: issuedToken.payload.ownerUserId,
					});
				}

				if (!issuedToken) {
					issuedToken = state.tokenStore.issueToken({
						type: "client",
						id: clientAuthRequest.clientId,
						key: clientAuthRequest.clientKey,
						ownerUserId,
					});
				}
				issuedToken = pairClientToOwnerAgentIfAvailable(issuedToken, ownerUserId);

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
				let issuedToken = state.tokenStore.findLatestByPrincipal(
					"client",
					clientHeartbeatRequest.clientId,
					clientHeartbeatRequest.clientKey,
					{ allowExpired: true },
				);
				if (ownerUserId && issuedToken?.payload.ownerUserId !== ownerUserId) {
					issuedToken = null;
				}
				if (!issuedToken) {
					issuedToken = state.tokenStore.issueToken({
						type: "client",
						id: clientHeartbeatRequest.clientId,
						key: clientHeartbeatRequest.clientKey,
						ownerUserId,
					});
				} else if (shouldRefreshToken(issuedToken)) {
					issuedToken = state.tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
						ownerUserId: issuedToken.payload.ownerUserId,
					});
				}
				issuedToken = pairClientToOwnerAgentIfAvailable(issuedToken, ownerUserId);

				sendJson(
					response,
					200,
					buildClientHeartbeatResponse(issuedToken, state.tokenStore, state.agentConnections),
					corsHeaders,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : "relay heartbeat failed";
				log("warn", "relay heartbeat failed", { error: message });
				sendJson(response, error instanceof AuthError ? 401 : 500, { message }, corsHeaders);
			}
			return;
		}

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
				let issuedToken = state.tokenStore.findLatestByPrincipal(
					"agent",
					agentAuthRequest.agentId,
					agentAuthRequest.agentKey,
					{ allowExpired: true },
				);
				if (ownerGrantUserId && issuedToken?.payload.ownerUserId !== ownerGrantUserId) {
					issuedToken = null;
				}
				if (ownerGrantUserId) {
					issuedToken = state.tokenStore.issueToken({
						type: "agent",
						id: agentAuthRequest.agentId,
						key: agentAuthRequest.agentKey,
						ownerUserId: ownerGrantUserId,
					});
				}
				if (issuedToken && !ownerGrantUserId && shouldRefreshToken(issuedToken)) {
					issuedToken = state.tokenStore.issueToken({
						type: "agent",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
						ownerUserId: issuedToken.payload.ownerUserId,
					});
				}

				if (!issuedToken) {
					sendJson(response, 400, { message: "Sign in locally to authenticate the relay agent." }, corsHeaders);
					return;
				}

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
				if (!state.tokenStore.findActiveToken(token)) {
					throw new AuthError("unknown token");
				}

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

		sendText(response, 404, "Not Found", corsHeaders);
	};
}
