import type { IncomingMessage } from "node:http";
import {
	assertRelayPrincipalId,
	type RelayPrincipalType,
} from "@apreal/shared";
import jwt, { type JwtPayload } from "jsonwebtoken";

// The relay accepts only two authenticated peer roles.
// Keeping the role set explicit prevents accidental support for extra values
// that might slip in through a malformed or malicious token.
export const USER_TYPES = ["agent", "client"] as const;
export const RELAY_JWT_EXPIRES_IN = "180d" as const;
export const RELAY_JWT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const OWNER_AGENT_GRANT_EXPIRES_IN_SECONDS = 5 * 60;

export type UserType = RelayPrincipalType;

// This is the exact token shape the relay trusts after verification.
// `iat` and `exp` are required so the runtime can reject tokens that were
// forged without standard JWT timing claims.
export type AuthTokenPayload = {
	type: UserType;
	id: string;
	key: string;
	targetId?: string;
	targetType?: UserType;
	serverUrl?: string;
	ownerUserId?: string;
	iat: number;
	exp: number;
};

export type OwnerAgentGrantPayload = {
	purpose: "agent_owner_grant";
	ownerUserId: string;
	iat: number;
	exp: number;
};

type GenerateTokenInput = {
	type: UserType;
	id: string;
	key: string;
	targetId?: string;
	targetType?: UserType;
	serverUrl?: string;
	ownerUserId?: string;
};

// Relay auth failures are treated as controlled protocol failures, not as
// fatal process errors. A dedicated error type makes it easy to distinguish
// expected auth rejection from unexpected runtime bugs in the caller.
export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

// The JWT secret is intentionally resolved lazily so local utilities such as
// tests or token generation scripts can set `process.env.JWT_SECRET` right
// before use. Missing secret configuration is a hard auth failure.
function getJwtSecret(): string {
	const secret = process.env.JWT_SECRET?.trim();
	if (!secret) {
		throw new AuthError("JWT_SECRET is not configured");
	}

	return secret;
}

// Small type guard used by both verification and token generation paths.
// Centralizing the role check keeps the accepted roles consistent everywhere.
function isUserType(value: unknown): value is UserType {
	return typeof value === "string" && USER_TYPES.includes(value as UserType);
}

// All externally supplied identifiers must be non-empty strings.
// The relay never accepts blank IDs because they break map registration and
// make audit logs ambiguous.
function ensureString(value: unknown, field: string): string {
	try {
		return assertRelayPrincipalId(value, field);
	} catch {
		throw new AuthError(`invalid token field: ${field}`);
	}
}

// JWT libraries may surface claim values as unknown, so numeric claims are
// explicitly checked before the payload is trusted.
function ensureNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new AuthError(`invalid token field: ${field}`);
	}

	return value;
}

function ensureServerUrl(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new AuthError(`invalid token field: ${field}`);
	}

	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new AuthError(`invalid token field: ${field}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new AuthError(`invalid token field: ${field}`);
	}

	url.hash = "";
	return url.toString();
}

// Verification proves the signature is valid, but it does not automatically
// guarantee that the payload matches the relay's expected contract. This
// function performs the final structural validation before the connection is
// treated as authenticated.
function validateTokenPayload(payload: string | JwtPayload): AuthTokenPayload {
	if (typeof payload === "string") {
		throw new AuthError("invalid token payload");
	}

	if (!isUserType(payload.type)) {
		throw new AuthError("invalid token role");
	}

	return {
		type: payload.type,
		id: ensureString(payload.id, "id"),
		key: ensureString(payload.key, "key"),
		targetId: payload.targetId === undefined ? undefined : ensureString(payload.targetId, "targetId"),
		targetType:
			payload.targetType === undefined
				? undefined
				: isUserType(payload.targetType)
					? payload.targetType
					: (() => {
						throw new AuthError("invalid token field: targetType");
					})(),
		serverUrl: payload.serverUrl === undefined ? undefined : ensureServerUrl(payload.serverUrl, "serverUrl"),
		ownerUserId: payload.ownerUserId === undefined ? undefined : ensureString(payload.ownerUserId, "ownerUserId"),
		iat: ensureNumber(payload.iat, "iat"),
		exp: ensureNumber(payload.exp, "exp"),
	};
}

function extractBearerToken(headerValue: string | string[] | undefined): string {
	if (!headerValue) {
		throw new AuthError("missing authorization header");
	}

	const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof header !== "string" || header.trim().length === 0) {
		throw new AuthError("invalid authorization header");
	}

	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	if (!match?.[1]) {
		throw new AuthError("invalid authorization header");
	}

	return match[1];
}

export function readRelayToken(token: string, options?: { ignoreExpiration?: boolean }): AuthTokenPayload {
	let decoded: string | JwtPayload;
	try {
		decoded = jwt.verify(token, getJwtSecret(), {
			algorithms: ["HS256"],
			ignoreExpiration: options?.ignoreExpiration ?? false,
		});
	} catch (error) {
		if (error instanceof AuthError) {
			throw error;
		}

		throw new AuthError(error instanceof Error ? error.message : "invalid token");
	}

	return validateTokenPayload(decoded);
}

export function readBearerTokenFromRequest(request: IncomingMessage): string {
	return extractBearerToken(request.headers.authorization);
}

export function authenticateHttpRequest(request: IncomingMessage): AuthTokenPayload {
	return readRelayToken(readBearerTokenFromRequest(request));
}

// Helper used for provisioning and local testing. Keeping the helper here
// ensures token creation and token validation share one contract.
export function generateToken({ type, id, key, targetId, targetType, serverUrl, ownerUserId }: GenerateTokenInput): string {
	if (!isUserType(type)) {
		throw new AuthError("invalid token role");
	}

	ensureString(id, "id");
	ensureString(key, "key");
	if (targetId !== undefined) {
		ensureString(targetId, "targetId");
	}
	if (targetType !== undefined && !isUserType(targetType)) {
		throw new AuthError("invalid token field: targetType");
	}
	if (serverUrl !== undefined) {
		ensureServerUrl(serverUrl, "serverUrl");
	}
	if (ownerUserId !== undefined) {
		ensureString(ownerUserId, "ownerUserId");
	}

	return jwt.sign({ type, id, key, targetId, targetType, serverUrl, ownerUserId }, getJwtSecret(), {
		algorithm: "HS256",
		expiresIn: RELAY_JWT_EXPIRES_IN,
	});
}

function validateOwnerAgentGrantPayload(payload: string | JwtPayload): OwnerAgentGrantPayload {
	if (typeof payload === "string") {
		throw new AuthError("invalid owner grant payload");
	}

	if (payload.purpose !== "agent_owner_grant") {
		throw new AuthError("invalid owner grant purpose");
	}

	return {
		purpose: "agent_owner_grant",
		ownerUserId: ensureString(payload.ownerUserId, "ownerUserId"),
		iat: ensureNumber(payload.iat, "iat"),
		exp: ensureNumber(payload.exp, "exp"),
	};
}

export function generateOwnerAgentGrant(ownerUserId: string): { ownerGrant: string; expiresAt: number } {
	const normalizedOwnerUserId = ensureString(ownerUserId, "ownerUserId");
	const ownerGrant = jwt.sign(
		{
			purpose: "agent_owner_grant",
			ownerUserId: normalizedOwnerUserId,
		},
		getJwtSecret(),
		{
			algorithm: "HS256",
			expiresIn: OWNER_AGENT_GRANT_EXPIRES_IN_SECONDS,
		},
	);
	const grant = readOwnerAgentGrant(ownerGrant);
	return {
		ownerGrant,
		expiresAt: grant.exp * 1000,
	};
}

export function readOwnerAgentGrant(ownerGrant: string): OwnerAgentGrantPayload {
	let decoded: string | JwtPayload;
	try {
		decoded = jwt.verify(ownerGrant, getJwtSecret(), {
			algorithms: ["HS256"],
		});
	} catch (error) {
		if (error instanceof AuthError) {
			throw error;
		}

		throw new AuthError(error instanceof Error ? error.message : "invalid owner grant");
	}

	return validateOwnerAgentGrantPayload(decoded);
}
