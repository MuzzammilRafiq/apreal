import type { IncomingMessage } from "node:http";
import type { RelayConnectionRequest, RelayConnectionResponse, RelayPrincipalType } from "@apreal/shared";
import {
	AuthError,
	readRelayToken,
	type AuthTokenPayload,
	type UserType,
} from "../auth.ts";
import type { StoredRelayToken } from "../token-store.ts";
import { RelayTokenStore } from "../token-store.ts";
import { TOKEN_REFRESH_WINDOW_MS } from "./constants.ts";
import { resolveRequestOrigin } from "./cors.ts";
import { getErrorMessage } from "./http.ts";

export function getDefaultTargetType(type: UserType): RelayPrincipalType {
	return type === "client" ? "agent" : "client";
}

export function authorizeRelayConnection(
	principal: AuthTokenPayload,
	request: RelayConnectionRequest,
): RelayConnectionResponse {
	const targetType = request.targetType ?? getDefaultTargetType(principal.type);
	const expectedTargetType = getDefaultTargetType(principal.type);
	if (targetType !== expectedTargetType) {
		throw new AuthError(`invalid target type for ${principal.type}`);
	}

	if (principal.targetType && principal.targetType !== targetType) {
		throw new AuthError("token target type mismatch");
	}

	if (principal.targetId && principal.targetId !== request.targetId) {
		throw new AuthError("token target id mismatch");
	}

	return {
		principal: {
			id: principal.id,
			type: principal.type,
			expiresAt: principal.exp * 1000,
			scopedToTarget: Boolean(principal.targetId || principal.targetType),
		},
		target: {
			id: request.targetId,
			type: targetType,
		},
	};
}

export function mapRelayConnectionErrorStatus(error: unknown): number {
	const message = error instanceof Error ? error.message : String(error);
	if (
		message === "invalid target type for client" ||
		message === "invalid target type for agent" ||
		message === "token target type mismatch" ||
		message === "token target id mismatch"
	) {
		return 403;
	}

	return 401;
}

export function shouldRefreshToken(entry: StoredRelayToken): boolean {
	return entry.payload.exp * 1000 - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

export function readOptionalBearerToken(headerValue: string | string[] | undefined): string | null {
	if (!headerValue) {
		return null;
	}

	const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof header !== "string" || header.trim().length === 0) {
		return null;
	}

	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}

export function readClientTokenFromProxyRequest(request: IncomingMessage): string {
	const headerToken = readOptionalBearerToken(request.headers.authorization);
	if (headerToken) {
		return headerToken;
	}

	const queryToken = new URL(request.url ?? "/", "http://relay.local").searchParams.get("token")?.trim();
	if (queryToken) {
		return queryToken;
	}

	throw new AuthError("missing client auth token");
}

export function resolveClientRelayTarget(request: IncomingMessage, tokenStore: RelayTokenStore) {
	const clientToken = readClientTokenFromProxyRequest(request);
	if (!tokenStore.findActiveToken(clientToken)) {
		throw new AuthError("unknown token");
	}

	const principal = readRelayToken(clientToken);
	if (principal.type !== "client") {
		throw new AuthError("only client tokens may access browser relay transport");
	}

	if ((principal.targetType ?? "agent") !== "agent") {
		throw new AuthError("client token target type mismatch");
	}

	if (!principal.targetId) {
		throw new AuthError("client token is not paired");
	}

	return {
		clientToken,
		clientId: principal.id,
		agentId: principal.targetId,
	};
}

export function mapRelayProxyErrorStatus(error: unknown): number {
	const message = getErrorMessage(error);
	if (
		message === "paired agent transport unavailable" ||
		message === "browser client stream is not connected"
	) {
		return 503;
	}

	if (
		message === "only client tokens may access browser relay transport" ||
		message === "client token target type mismatch" ||
		message === "client token is not paired"
	) {
		return 403;
	}

	return 401;
}

export function validateAgentServerUrl(request: IncomingMessage, serverUrl?: string) {
	if (!serverUrl) {
		return;
	}

	const requestOrigin = resolveRequestOrigin(request);
	if (!requestOrigin) {
		return;
	}

	if (new URL(serverUrl).origin === new URL(requestOrigin).origin) {
		throw new Error("serverUrl must not point to the relay origin");
	}
}
