import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
	RELAY_AGENT_AUTH_PATH,
	RELAY_AGENT_OWNER_GRANT_PATH,
} from "@apreal/shared";

import {
	AuthError,
	generateOwnerAgentGrant,
	readOwnerAgentGrant,
} from "../../auth/relay-token.ts";
import { audit, getAuditRequestFields } from "../../observability/audit.ts";
import { log } from "../../observability/log.ts";
import type { RelayRouterContext } from "../context.ts";
import { registerMethodNotAllowed } from "../http/routing.ts";
import { sendJson } from "../http/response.ts";
import { parseAgentAuthRequest } from "../protocol/parsing.ts";
import { buildAgentAuthResponse } from "../protocol/responses.ts";

export function createAgentAuthRouter(context: RelayRouterContext) {
	const router = Router();
	const { state, transports } = context;

	router.post(RELAY_AGENT_OWNER_GRANT_PATH, async (request, response) => {
		try {
			const ownerUserId = await context.readRequiredOwnerUserId(request);
			if (!ownerUserId) {
				throw new AuthError("signed-in user session is required");
			}

			const ownerGrant = generateOwnerAgentGrant(ownerUserId);
			audit("auth.owner_grant_issued", "success", {
				actorType: "user",
				actorId: ownerUserId,
				...getAuditRequestFields(request),
			});
			sendJson(response, 200, ownerGrant);
		} catch (error) {
			const message = error instanceof Error ? error.message : "agent owner grant failed";
			const statusCode = error instanceof AuthError ? 401 : 500;
			audit("authorization.failed", "failure", {
				...getAuditRequestFields(request),
				statusCode,
				reason: error instanceof AuthError ? "session_required" : "unexpected_error",
				transport: "http",
			});
			log("warn", "agent owner grant failed", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_AGENT_OWNER_GRANT_PATH);

	router.post(RELAY_AGENT_AUTH_PATH, async (request, response) => {
		const agentAuthRequest = await parseAgentAuthRequest(request);
		if (!agentAuthRequest) {
			audit("authorization.failed", "failure", {
				...getAuditRequestFields(request),
				statusCode: 400,
				reason: "invalid_request",
				transport: "http",
			});
			sendJson(response, 400, { message: "Invalid agent auth request." });
			return;
		}

		try {
			const ownerGrantUserId = agentAuthRequest.ownerGrant
				? readOwnerAgentGrant(agentAuthRequest.ownerGrant).ownerUserId
				: undefined;
			if (agentAuthRequest.rotateCredential && !ownerGrantUserId) {
				throw new AuthError("owner grant is required to rotate an agent credential");
			}
			const ownerUserId = ownerGrantUserId
				?? state.ownerBindingStore.findOwnerUserIdForAgent(agentAuthRequest.agentId, agentAuthRequest.agentKey);
			if (!ownerUserId) {
				audit("authorization.failed", "failure", {
					actorType: "agent",
					actorId: agentAuthRequest.agentId,
					...getAuditRequestFields(request),
					statusCode: 400,
					reason: "missing_owner_binding",
					transport: "http",
				});
				sendJson(response, 400, { message: "Sign in locally to authenticate the relay agent." });
				return;
			}

			let binding = state.ownerBindingStore.findLatestAgentByOwnerUserId(ownerUserId);
			const displacedBinding = state.ownerBindingStore.findAgent(agentAuthRequest.agentId);
			const agentKey = agentAuthRequest.rotateCredential ? `key-${randomUUID()}` : agentAuthRequest.agentKey;
			if (ownerGrantUserId) {
				if (displacedBinding && displacedBinding.ownerUserId !== ownerUserId) {
					if (displacedBinding.credentialId) {
						state.credentialStore.revoke(displacedBinding.credentialId, displacedBinding.ownerUserId);
					}
					if (state.agentSessions.get(displacedBinding.agentId)?.credentialId === displacedBinding.credentialId) {
						state.agentSessions.delete(displacedBinding.agentId);
					}
					const connection = state.agentConnections.get(displacedBinding.agentId);
					if (!displacedBinding.credentialId || connection?.credentialId === displacedBinding.credentialId) {
						connection?.close("agent_owner_reassigned");
					}
					for (const client of transports.listBrowserClientsForAgent(displacedBinding.agentId)) {
						if (client.ownerUserId === displacedBinding.ownerUserId) {
							client.close("agent_owner_reassigned");
						}
					}
				}

				if (binding && (
					agentAuthRequest.rotateCredential
					|| binding.agentId !== agentAuthRequest.agentId
					|| binding.agentKey !== agentKey
				)) {
					if (binding.credentialId) {
						state.credentialStore.revoke(binding.credentialId, ownerUserId);
					}
				}

				const credentialId = binding?.agentId === agentAuthRequest.agentId
					&& binding.agentKey === agentKey
					&& !agentAuthRequest.rotateCredential
					&& binding.credentialId
					&& state.credentialStore.get(binding.credentialId)?.revokedAt === null
					? binding.credentialId
					: state.credentialStore.create("agent", agentAuthRequest.agentId, ownerUserId).credentialId;
				state.ownerBindingStore.bindAgentToOwner(
					agentAuthRequest.agentId,
					agentKey,
					ownerGrantUserId,
					credentialId,
				);
				binding = state.ownerBindingStore.findLatestAgentByOwnerUserId(ownerUserId);
				audit("pairing.agent_bound", "success", {
					actorType: "agent",
					actorId: agentAuthRequest.agentId,
					ownerUserId: ownerGrantUserId,
				});
				if (agentAuthRequest.rotateCredential) {
					transports.closeAgentConnection(agentAuthRequest.agentId, "agent_credential_rotated");
					audit("auth.credential_rotated", "success", {
						actorType: "agent",
						actorId: agentAuthRequest.agentId,
						ownerUserId,
					});
				}
			}

			if (!binding || binding.agentId !== agentAuthRequest.agentId || binding.agentKey !== agentKey) {
				throw new AuthError("agent credential is revoked");
			}
			let credentialId = binding.credentialId;
			if (!credentialId) {
				credentialId = state.credentialStore.create("agent", agentAuthRequest.agentId, ownerUserId).credentialId;
				state.ownerBindingStore.bindAgentToOwner(agentAuthRequest.agentId, agentKey, ownerUserId, credentialId);
			}
			state.credentialStore.assertActive(credentialId, "agent", agentAuthRequest.agentId);

			const isTokenRefresh = state.agentSessions.has(agentAuthRequest.agentId);
			const issuedToken = context.issueAgentToken(agentAuthRequest.agentId, agentKey, ownerUserId, credentialId);
			audit(isTokenRefresh ? "auth.token_refreshed" : "auth.token_issued", "success", {
				actorType: "agent",
				actorId: issuedToken.payload.id,
				ownerUserId,
				...getAuditRequestFields(request),
			});
			sendJson(response, 200, buildAgentAuthResponse(issuedToken));
		} catch (error) {
			const message = error instanceof Error ? error.message : "agent auth failed";
			const statusCode = error instanceof AuthError ? 401 : 500;
			audit("authorization.failed", "failure", {
				actorType: "agent",
				actorId: agentAuthRequest.agentId,
				...getAuditRequestFields(request),
				statusCode,
				reason: error instanceof AuthError ? "request_rejected" : "unexpected_error",
				transport: "http",
			});
			log("warn", "agent auth failed", { error: message });
			sendJson(response, statusCode, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_AGENT_AUTH_PATH);

	return router;
}
