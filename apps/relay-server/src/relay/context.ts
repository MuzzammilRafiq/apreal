import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
	AuthError,
	issueRelayBrowserIdentity,
	issueRelayToken,
	readRelayBrowserIdentity,
	type IssuedRelayToken,
} from "../auth/relay-token.ts";
import { isBetterAuthConfigured, readBetterAuthUserId } from "../auth/better-auth.ts";
import { audit } from "../observability/audit.ts";
import type { RelayServerState } from "./state.ts";
import { createRelayTransportHandlers } from "./transport/handlers.ts";

export type RelayTransportHandlers = ReturnType<typeof createRelayTransportHandlers>;

export type RelayRouterContext = {
	state: RelayServerState;
	transports: RelayTransportHandlers;
	readRequiredOwnerUserId(request: IncomingMessage): Promise<string | undefined>;
	issueClientToken(clientId: string, credentialId: string, ownerUserId: string | undefined): IssuedRelayToken;
	resolveBrowserIdentity(request: IncomingMessage, ownerUserId: string | undefined, rotate?: boolean): ReturnType<typeof issueRelayBrowserIdentity>;
	issueAgentToken(agentId: string, agentKey: string, ownerUserId: string, credentialId: string): IssuedRelayToken;
};

// Creates the stateful operations shared by the smaller Express route modules.
export function createRelayRouterContext(state: RelayServerState): RelayRouterContext {
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

	function issueClientToken(
		clientId: string,
		credentialId: string,
		ownerUserId: string | undefined,
	): IssuedRelayToken {
		const ownerAgent = ownerUserId
			? state.ownerBindingStore.findLatestAgentByOwnerUserId(ownerUserId)
			: null;

		return issueRelayToken({
			type: "client",
			id: clientId,
			credentialId,
			targetId: ownerAgent?.agentId,
			targetType: ownerAgent ? "agent" : undefined,
			ownerUserId,
		}, state.credentialStore);
	}

	function resolveBrowserIdentity(request: IncomingMessage, ownerUserId: string | undefined, rotate = false) {
		if (!ownerUserId) {
			throw new AuthError("signed-in user session is required");
		}

		const existing = readRelayBrowserIdentity(request);
		if (existing && !rotate) {
			const credential = state.credentialStore.get(existing.credentialId);
			if (credential?.ownerUserId === ownerUserId && credential.revokedAt === null) {
				return issueRelayBrowserIdentity(existing);
			}
			if (credential?.ownerUserId === ownerUserId) {
				throw new AuthError("relay browser credential is revoked");
			}
		}

		if (existing && rotate) {
			const credential = state.credentialStore.get(existing.credentialId);
			if (credential?.ownerUserId === ownerUserId) {
				state.credentialStore.revoke(existing.credentialId, ownerUserId);
				transports.closeBrowserClient(existing.clientId, "client_credential_rotated");
				audit("auth.credential_rotated", "success", {
					actorType: "client",
					actorId: existing.clientId,
					ownerUserId,
				});
			}
		}

		const identity = {
			clientId: `client-${randomUUID()}`,
			clientKey: `key-${randomUUID()}`,
			credentialId: "",
		};
		identity.credentialId = state.credentialStore.create("client", identity.clientId, ownerUserId).credentialId;
		return issueRelayBrowserIdentity(identity);
	}

	function issueAgentToken(
		agentId: string,
		agentKey: string,
		ownerUserId: string,
		credentialId: string,
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
			credentialId,
			key: agentKey,
			ownerUserId,
		}, state.credentialStore);
		state.agentSessions.set(agentId, issuedToken.payload);
		return issuedToken;
	}

	return {
		state,
		transports,
		readRequiredOwnerUserId,
		issueClientToken,
		resolveBrowserIdentity,
		issueAgentToken,
	};
}
