import type { IncomingMessage } from "node:http";
import jwt, { type JwtPayload } from "jsonwebtoken";

// The relay accepts only two authenticated peer roles.
// Keeping the role set explicit prevents accidental support for extra values
// that might slip in through a malformed or malicious token.
export const USER_TYPES = ["agent", "client"] as const;

export type UserType = (typeof USER_TYPES)[number];

// This is the exact token shape the relay trusts after verification.
// `iat` and `exp` are required so the runtime can reject tokens that were
// forged without standard JWT timing claims.
export type AuthTokenPayload = {
	type: UserType;
	id: string;
	iat: number;
	exp: number;
};

type GenerateTokenInput = {
	type: UserType;
	id: string;
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
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new AuthError(`invalid token field: ${field}`);
	}

	return value;
}

// JWT libraries may surface claim values as unknown, so numeric claims are
// explicitly checked before the payload is trusted.
function ensureNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new AuthError(`invalid token field: ${field}`);
	}

	return value;
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
		iat: ensureNumber(payload.iat, "iat"),
		exp: ensureNumber(payload.exp, "exp"),
	};
}

// The relay accepts bearer tokens only from the upgrade request headers.
// Tokens are never read from query params or message frames because headers
// keep the auth step separate from the application protocol.
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

// Authenticate a websocket upgrade request using the configured shared secret.
// Only HS256 is allowed so peers cannot switch to a weaker or unintended
// algorithm through crafted token headers.
export function authenticateRequest(request: IncomingMessage): AuthTokenPayload {
	const token = extractBearerToken(request.headers.authorization);
	const decoded = jwt.verify(token, getJwtSecret(), {
		algorithms: ["HS256"],
	});

	return validateTokenPayload(decoded);
}

// Helper used for provisioning and local testing. The relay itself does not
// mint tokens during websocket handling; it only verifies them. Keeping the
// helper here ensures token creation and token validation share one contract.
export function generateToken({ type, id }: GenerateTokenInput): string {
	if (!isUserType(type)) {
		throw new AuthError("invalid token role");
	}

	ensureString(id, "id");

	return jwt.sign({ type, id }, getJwtSecret(), {
		algorithm: "HS256",
		expiresIn: "24h",
	});
}