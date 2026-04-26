import type { IncomingMessage } from "node:http";
import {
	assertRelayPairingCode,
	assertRelayPrincipalId,
	RELAY_BROWSER_PROTOCOL,
	type RelayPrincipalType,
} from "@apreal/shared";
import jwt, { type JwtPayload } from "jsonwebtoken";

// The relay accepts only two authenticated peer roles.
// Keeping the role set explicit prevents accidental support for extra values
// that might slip in through a malformed or malicious token.
export const USER_TYPES = ["agent", "client"] as const;
export const RELAY_JWT_EXPIRES_IN = "24h" as const;
export const RELAY_JWT_TTL_MS = 24 * 60 * 60 * 1000;

export type UserType = RelayPrincipalType;

// This is the exact token shape the relay trusts after verification.
// `iat` and `exp` are required so the runtime can reject tokens that were
// forged without standard JWT timing claims.
export type AuthTokenPayload = {
	type: UserType;
	id: string;
	pairingCode?: string;
	targetId?: string;
	targetType?: UserType;
	iat: number;
	exp: number;
};

type GenerateTokenInput = {
	type: UserType;
	id: string;
	pairingCode?: string;
	targetId?: string;
	targetType?: UserType;
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

function ensurePairingCode(value: unknown, field: string): string {
	try {
		return assertRelayPairingCode(value, field);
	} catch {
		throw new AuthError(`invalid token field: ${field}`);
	}
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
		pairingCode: payload.pairingCode === undefined ? undefined : ensurePairingCode(payload.pairingCode, "pairingCode"),
		targetId: payload.targetId === undefined ? undefined : ensureString(payload.targetId, "targetId"),
		targetType:
			payload.targetType === undefined
				? undefined
				: isUserType(payload.targetType)
					? payload.targetType
					: (() => {
						throw new AuthError("invalid token field: targetType");
					})(),
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

function extractProtocolToken(headerValue: string | string[] | undefined): string {
	if (!headerValue) {
		throw new AuthError("missing websocket protocol token");
	}

	const header = Array.isArray(headerValue) ? headerValue.join(",") : headerValue;
	const protocols = header
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	const markerIndex = protocols.indexOf(RELAY_BROWSER_PROTOCOL);
	if (markerIndex === -1 || markerIndex === protocols.length - 1) {
		throw new AuthError("invalid websocket protocol token");
	}

	return protocols[markerIndex + 1] ?? "";
}

function extractRequestToken(request: IncomingMessage, source: "authorization" | "authorization-or-protocol"): string {
	if (source === "authorization") {
		return extractBearerToken(request.headers.authorization);
	}

	try {
		return extractBearerToken(request.headers.authorization);
	} catch (error) {
		if (!(error instanceof AuthError)) {
			throw error;
		}
	}

	return extractProtocolToken(request.headers["sec-websocket-protocol"]);
}

function verifyRelayToken(token: string): AuthTokenPayload {
	let decoded: string | JwtPayload;
	try {
		decoded = jwt.verify(token, getJwtSecret(), {
			algorithms: ["HS256"],
		});
	} catch (error) {
		if (error instanceof AuthError) {
			throw error;
		}

		throw new AuthError(error instanceof Error ? error.message : "invalid token");
	}

	return validateTokenPayload(decoded);
}

// Authenticate a websocket upgrade request using the configured shared secret.
// Only HS256 is allowed so peers cannot switch to a weaker or unintended
// algorithm through crafted token headers.
export function authenticateRequest(request: IncomingMessage): AuthTokenPayload {
	return verifyRelayToken(extractRequestToken(request, "authorization-or-protocol"));
}

export function authenticateHttpRequest(request: IncomingMessage): AuthTokenPayload {
	return verifyRelayToken(extractRequestToken(request, "authorization"));
}

// Helper used for provisioning and local testing. The relay itself does not
// mint tokens during websocket handling; it only verifies them. Keeping the
// helper here ensures token creation and token validation share one contract.
export function generateToken({ type, id, pairingCode, targetId, targetType }: GenerateTokenInput): string {
	if (!isUserType(type)) {
		throw new AuthError("invalid token role");
	}

	ensureString(id, "id");
	if (pairingCode !== undefined) {
		ensurePairingCode(pairingCode, "pairingCode");
	}
	if (targetId !== undefined) {
		ensureString(targetId, "targetId");
	}
	if (targetType !== undefined && !isUserType(targetType)) {
		throw new AuthError("invalid token field: targetType");
	}

	return jwt.sign({ type, id, pairingCode, targetId, targetType }, getJwtSecret(), {
		algorithm: "HS256",
		expiresIn: RELAY_JWT_EXPIRES_IN,
	});
}
