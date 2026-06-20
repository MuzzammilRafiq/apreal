import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	LOCAL_AUTH_SESSION_HEADER,
	LOCAL_AUTH_SESSION_QUERY_PARAM,
} from "@apreal/shared";

const LOCAL_AUTH_COOKIE_NAME = "apreal_local_auth";
const LOCAL_AUTH_TTL_MS = 30 * 60 * 1000;
const LOCAL_AUTH_SECRET = randomBytes(32);

type LocalAuthPayload = {
	exp: number;
	sid: string;
	secretHash: string;
};

export type IssuedLocalBrowserAuthSession = {
	cookieHeader: string;
	sessionSecret: string;
};

function encodePayload(payload: LocalAuthPayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): LocalAuthPayload | null {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			typeof (parsed as Record<string, unknown>).sid !== "string" ||
			typeof (parsed as Record<string, unknown>).secretHash !== "string" ||
			typeof (parsed as Record<string, unknown>).exp !== "number"
		) {
			return null;
		}

		return {
			sid: (parsed as Record<string, unknown>).sid as string,
			secretHash: (parsed as Record<string, unknown>).secretHash as string,
			exp: (parsed as Record<string, unknown>).exp as number,
		};
	} catch {
		return null;
	}
}

function signPayload(encodedPayload: string): string {
	return createHmac("sha256", LOCAL_AUTH_SECRET).update(encodedPayload).digest("base64url");
}

function hashSessionSecret(sessionSecret: string): string {
	return createHash("sha256").update(sessionSecret).digest("base64url");
}

function createCookie(name: string, value: string, options?: { expiresAt?: number; maxAgeSeconds?: number }) {
	const parts = [
		`${name}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
	];

	if (typeof options?.maxAgeSeconds === "number") {
		parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
	}

	if (typeof options?.expiresAt === "number") {
		parts.push(`Expires=${new Date(options.expiresAt).toUTCString()}`);
	}

	return parts.join("; ");
}

function readCookieValue(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) {
		return null;
	}

	for (const entry of cookieHeader.split(";")) {
		const [rawName, ...rawValueParts] = entry.trim().split("=");
		if (rawName !== name) {
			continue;
		}

		const rawValue = rawValueParts.join("=").trim();
		return rawValue || null;
	}

	return null;
}

function readLocalAuthPayload(request: Request): LocalAuthPayload | null {
	const cookieValue = readCookieValue(request, LOCAL_AUTH_COOKIE_NAME);
	if (!cookieValue) {
		return null;
	}

	const [encodedPayload, signature] = cookieValue.split(".", 2);
	if (!encodedPayload || !signature) {
		return null;
	}

	const expectedSignature = signPayload(encodedPayload);
	const signatureBuffer = Buffer.from(signature, "utf8");
	const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
	if (
		signatureBuffer.length !== expectedSignatureBuffer.length ||
		!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
	) {
		return null;
	}

	const payload = decodePayload(encodedPayload);
	if (!payload || payload.exp <= Date.now()) {
		return null;
	}

	return payload;
}

function readRequestSessionSecret(request: Request, allowQuery: boolean): string | null {
	const headerSecret = request.headers.get(LOCAL_AUTH_SESSION_HEADER)?.trim();
	if (headerSecret) {
		return headerSecret;
	}

	if (!allowQuery) {
		return null;
	}

	return new URL(request.url).searchParams.get(LOCAL_AUTH_SESSION_QUERY_PARAM)?.trim() || null;
}

export function hasLocalBrowserAuthSession(request: Request, options?: { allowQuery?: boolean }): boolean {
	const payload = readLocalAuthPayload(request);
	const sessionSecret = readRequestSessionSecret(request, options?.allowQuery === true);
	if (!payload || !sessionSecret) {
		return false;
	}

	const actualHash = Buffer.from(hashSessionSecret(sessionSecret), "utf8");
	const expectedHash = Buffer.from(payload.secretHash, "utf8");
	return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

export function createLocalBrowserAuthSession(): IssuedLocalBrowserAuthSession {
	const expiresAt = Date.now() + LOCAL_AUTH_TTL_MS;
	const sessionSecret = randomBytes(32).toString("base64url");
	const payload: LocalAuthPayload = {
		sid: crypto.randomUUID(),
		secretHash: hashSessionSecret(sessionSecret),
		exp: expiresAt,
	};
	const encodedPayload = encodePayload(payload);
	const cookieValue = `${encodedPayload}.${signPayload(encodedPayload)}`;

	return {
		cookieHeader: createCookie(LOCAL_AUTH_COOKIE_NAME, cookieValue, {
			expiresAt,
			maxAgeSeconds: LOCAL_AUTH_TTL_MS / 1000,
		}),
		sessionSecret,
	};
}

export function createClearedLocalBrowserAuthSessionCookieHeader(): string {
	return createCookie(LOCAL_AUTH_COOKIE_NAME, "", {
		expiresAt: 0,
		maxAgeSeconds: 0,
	});
}
