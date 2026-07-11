import { Router } from "express";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	RELAY_CONNECTION_PATH,
} from "@apreal/shared";

import { readBearerTokenFromRequest, readRelayToken } from "../../auth/relay-token.ts";
import { audit, getAuditRequestFields } from "../../observability/audit.ts";
import { log } from "../../observability/log.ts";
import {
	authorizeRelayConnection,
	mapRelayConnectionErrorStatus,
	mapRelayProxyErrorStatus,
} from "../protocol/authorization.ts";
import type { RelayRouterContext } from "../context.ts";
import { createCorsHeaders } from "../http/cors.ts";
import { registerMethodNotAllowed } from "../http/routing.ts";
import { getErrorMessage, sendJson } from "../http/response.ts";
import { parseRelayConnectionRequest } from "../protocol/parsing.ts";

export function createTransportRouter(context: RelayRouterContext) {
	const router = Router();
	const { state, transports } = context;

	router.get(RELAY_AGENT_STREAM_PATH, (request, response) => {
		try {
			transports.handleAgentStreamRequest(request, response, createCorsHeaders(request));
		} catch (error) {
			const message = getErrorMessage(error);
			const statusCode = message === "only agent tokens may open relay agent transport" ? 403 : 401;
			audit("authorization.failed", "failure", {
				actorType: "agent",
				...getAuditRequestFields(request),
				statusCode,
				reason: "request_rejected",
				transport: "sse",
			});
			log("warn", "relay agent stream rejected", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_AGENT_STREAM_PATH);

	router.post(RELAY_AGENT_MESSAGE_PATH, async (request, response) => {
		try {
			await transports.handleAgentMessageRequest(request, response, createCorsHeaders(request));
		} catch (error) {
			const message = getErrorMessage(error);
			const statusCode = message === "only agent tokens may post relay agent messages" ? 403 : 401;
			audit("authorization.failed", "failure", {
				actorType: "agent",
				...getAuditRequestFields(request),
				statusCode,
				reason: "request_rejected",
				transport: "http",
			});
			log("warn", "relay agent message rejected", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_AGENT_MESSAGE_PATH);

	router.get(CLIENT_EVENT_STREAM_PATH, (request, response) => {
		try {
			transports.registerBrowserClientStream(request, response, createCorsHeaders(request));
		} catch (error) {
			const statusCode = mapRelayProxyErrorStatus(error);
			const message = getErrorMessage(error);
			if (statusCode === 401 || statusCode === 403) {
				audit("authorization.failed", "failure", {
					actorType: "client",
					...getAuditRequestFields(request),
					statusCode,
					reason: "request_rejected",
					transport: "sse",
				});
			}
			log("warn", "relay stream request rejected", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, CLIENT_EVENT_STREAM_PATH);

	router.post(CLIENT_MESSAGE_PATH, async (request, response) => {
		try {
			await transports.handleClientMessageRequest(request, response, createCorsHeaders(request));
		} catch (error) {
			const statusCode = mapRelayProxyErrorStatus(error);
			const message = getErrorMessage(error);
			if (statusCode === 401 || statusCode === 403) {
				audit("authorization.failed", "failure", {
					actorType: "client",
					...getAuditRequestFields(request),
					statusCode,
					reason: "request_rejected",
					transport: "http",
				});
			}
			log("warn", "relay message request rejected", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, CLIENT_MESSAGE_PATH);

	router.post(RELAY_CONNECTION_PATH, async (request, response) => {
		const connectionRequest = await parseRelayConnectionRequest(request);
		if (!connectionRequest) {
			audit("authorization.failed", "failure", {
				...getAuditRequestFields(request),
				statusCode: 400,
				reason: "invalid_request",
				transport: "http",
			});
			sendJson(response, 400, { message: "Invalid relay connection request." });
			return;
		}

		try {
			const token = readBearerTokenFromRequest(request);
			const principal = readRelayToken(token, { credentialStore: state.credentialStore });
			const payload = authorizeRelayConnection(principal, connectionRequest);
			sendJson(response, 200, payload);
		} catch (error) {
			const statusCode = mapRelayConnectionErrorStatus(error);
			const message = error instanceof Error ? error.message : "relay connection authorization failed";
			audit("authorization.failed", "failure", {
				...getAuditRequestFields(request),
				statusCode,
				reason: "request_rejected",
				transport: "http",
			});
			log("warn", "relay http connection rejected", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_CONNECTION_PATH);

	return router;
}
