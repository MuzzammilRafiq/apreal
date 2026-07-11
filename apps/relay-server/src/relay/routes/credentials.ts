import { Router } from "express";
import {
	RELAY_CREDENTIALS_PATH,
	RELAY_CREDENTIAL_REVOKE_PATH,
} from "@apreal/shared";

import { AuthError } from "../../auth/relay-token.ts";
import { audit, getAuditRequestFields } from "../../observability/audit.ts";
import type { RelayRouterContext } from "../context.ts";
import { registerMethodNotAllowed } from "../http/routing.ts";
import { getErrorMessage, readRequestBody, sendJson } from "../http/response.ts";
import { isObjectRecord, readStringField } from "../protocol/parsing.ts";

export function createCredentialRouter(context: RelayRouterContext) {
	const router = Router();
	const { state, transports } = context;

	router.get(RELAY_CREDENTIALS_PATH, async (request, response) => {
		try {
			const ownerUserId = await context.readRequiredOwnerUserId(request);
			if (!ownerUserId) {
				throw new AuthError("signed-in user session is required");
			}
			const credentials = state.credentialStore
				.listForOwner(ownerUserId)
				.map(({ ownerUserId: _owner, ...credential }) => credential);
			sendJson(response, 200, { credentials });
		} catch (error) {
			const message = getErrorMessage(error);
			sendJson(response, error instanceof AuthError ? 401 : 500, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_CREDENTIALS_PATH);

	router.post(RELAY_CREDENTIAL_REVOKE_PATH, async (request, response) => {
		try {
			const ownerUserId = await context.readRequiredOwnerUserId(request);
			if (!ownerUserId) {
				throw new AuthError("signed-in user session is required");
			}

			let body: unknown;
			try {
				body = JSON.parse(await readRequestBody(request));
			} catch {
				body = null;
			}
			const credentialId = isObjectRecord(body) ? readStringField(body.credentialId) : null;
			if (!credentialId) {
				sendJson(response, 400, { message: "Invalid credential revocation request." });
				return;
			}

			const existingCredential = state.credentialStore.get(credentialId);
			const credential = state.credentialStore.revoke(credentialId, ownerUserId);
			if (!credential) {
				sendJson(response, 404, { message: "Relay credential not found." });
				return;
			}
			if (existingCredential && existingCredential.revokedAt !== null) {
				sendJson(response, 200, { ok: true });
				return;
			}

			if (credential.type === "agent") {
				const binding = state.ownerBindingStore.findAgent(credential.principalId);
				if (binding?.credentialId === credential.credentialId) {
					state.ownerBindingStore.removeAgent(credential.principalId);
					for (const client of transports.listBrowserClientsForAgent(credential.principalId)) {
						client.close("agent_credential_revoked");
					}
				}
				if (state.agentSessions.get(credential.principalId)?.credentialId === credential.credentialId) {
					state.agentSessions.delete(credential.principalId);
				}
				const connection = state.agentConnections.get(credential.principalId);
				if (connection?.credentialId === credential.credentialId) {
					connection.close("agent_credential_revoked");
				}
			} else {
				transports.closeBrowserClient(credential.principalId, "client_credential_revoked");
			}

			audit("auth.credential_revoked", "success", {
				actorType: credential.type,
				actorId: credential.principalId,
				ownerUserId,
				...getAuditRequestFields(request),
			});
			sendJson(response, 200, { ok: true });
		} catch (error) {
			const message = getErrorMessage(error);
			sendJson(response, error instanceof AuthError ? 401 : 500, { message });
		}
	});
	registerMethodNotAllowed(router, RELAY_CREDENTIAL_REVOKE_PATH);

	return router;
}
