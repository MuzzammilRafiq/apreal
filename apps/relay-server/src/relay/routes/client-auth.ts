import { Router, type Request, type Response } from "express";
import {
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
} from "@apreal/shared";

import { AuthError, readOwnerAgentGrant } from "../../auth/relay-token.ts";
import { audit, getAuditRequestFields } from "../../observability/audit.ts";
import { log } from "../../observability/log.ts";
import type { RelayRouterContext } from "../context.ts";
import { registerMethodNotAllowed } from "../http/routing.ts";
import { sendJson } from "../http/response.ts";
import { parseClientAuthRequest } from "../protocol/parsing.ts";
import {
	buildClientAuthResponse,
	buildClientHeartbeatResponse,
} from "../protocol/responses.ts";

type ClientTokenMode = "issue" | "refresh";

async function handleClientTokenRequest(
	context: RelayRouterContext,
	request: Request,
	response: Response,
	mode: ClientTokenMode,
) {
	const clientAuthRequest = await parseClientAuthRequest(request);
	if (!clientAuthRequest) {
		audit("authorization.failed", "failure", {
			...getAuditRequestFields(request),
			statusCode: 400,
			reason: "invalid_request",
			transport: "http",
		});
		sendJson(response, 400, {
			message: mode === "issue" ? "Invalid client auth request." : "Invalid relay heartbeat request.",
		});
		return;
	}

	try {
		const ownerGrantUserId = clientAuthRequest.ownerGrant
			? readOwnerAgentGrant(clientAuthRequest.ownerGrant).ownerUserId
			: undefined;
		const ownerUserId = ownerGrantUserId ?? await context.readRequiredOwnerUserId(request);
		const browserIdentity = context.resolveBrowserIdentity(
			request,
			ownerUserId,
			clientAuthRequest.rotateCredential,
		);
		const issuedToken = context.issueClientToken(
			browserIdentity.identity.clientId,
			browserIdentity.identity.credentialId,
			ownerUserId,
		);

		audit(mode === "issue" ? "auth.token_issued" : "auth.token_refreshed", "success", {
			actorType: "client",
			actorId: issuedToken.payload.id,
			ownerUserId: issuedToken.payload.ownerUserId,
			targetType: issuedToken.payload.targetType,
			targetId: issuedToken.payload.targetId,
			...getAuditRequestFields(request),
		});

		if (mode === "issue" && issuedToken.payload.targetId) {
			audit("pairing.client_resolved", "success", {
				actorType: "client",
				actorId: issuedToken.payload.id,
				ownerUserId: issuedToken.payload.ownerUserId,
				targetType: "agent",
				targetId: issuedToken.payload.targetId,
			});
		}

		const payload = mode === "issue"
			? buildClientAuthResponse(issuedToken)
			: buildClientHeartbeatResponse(
				issuedToken,
				context.state.agentSessions,
				context.state.agentConnections,
			);
		sendJson(response, 200, payload, { "set-cookie": browserIdentity.cookieHeader });
	} catch (error) {
		const fallbackMessage = mode === "issue" ? "client auth failed" : "relay heartbeat failed";
		const message = error instanceof Error ? error.message : fallbackMessage;
		const statusCode = error instanceof AuthError ? 401 : 500;
		audit("authorization.failed", "failure", {
			...getAuditRequestFields(request),
			statusCode,
			reason: error instanceof AuthError ? "request_rejected" : "unexpected_error",
			transport: "http",
		});
		log("warn", `${mode === "issue" ? "client auth" : "relay heartbeat"} failed`, { error: message });
		sendJson(response, statusCode, { message });
	}
}

export function createClientAuthRouter(context: RelayRouterContext) {
	const router = Router();

	router.post(RELAY_CLIENT_AUTH_PATH, (request, response) =>
		handleClientTokenRequest(context, request, response, "issue"));
	registerMethodNotAllowed(router, RELAY_CLIENT_AUTH_PATH);

	router.post(RELAY_CLIENT_HEARTBEAT_PATH, (request, response) =>
		handleClientTokenRequest(context, request, response, "refresh"));
	registerMethodNotAllowed(router, RELAY_CLIENT_HEARTBEAT_PATH);

	return router;
}
