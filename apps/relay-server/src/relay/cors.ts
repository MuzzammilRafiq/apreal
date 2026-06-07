import type { IncomingMessage } from "node:http";

function normalizeUrlOrigin(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}

		return url.origin;
	} catch {
		return null;
	}
}

export function resolveRequestOrigin(request: IncomingMessage): string | null {
	const host = request.headers.host?.trim();
	if (!host) {
		return null;
	}

	const forwardedProto = request.headers["x-forwarded-proto"];
	const protocol = typeof forwardedProto === "string" && forwardedProto.trim()
		? forwardedProto.split(",")[0]?.trim() ?? "http"
		: "http";

	return `${protocol}://${host}`;
}

export function createCorsHeaders(request?: IncomingMessage): Record<string, string> {
	const requestOrigin = normalizeUrlOrigin(typeof request?.headers.origin === "string" ? request.headers.origin : null);
	const configuredOrigins = [
		process.env.RELAY_CORS_ALLOW_ORIGINS,
		process.env.RELAY_CORS_ALLOW_ORIGIN,
		process.env.BETTER_AUTH_URL,
		process.env.APREAL_AUTH_URL,
		process.env.BETTER_AUTH_TRUSTED_ORIGINS,
	]
		.flatMap((value) => (value ?? "").split(","))
		.map((value) => normalizeUrlOrigin(value))
		.filter((value): value is string => value !== null);
	const requestServerOrigin = request ? normalizeUrlOrigin(resolveRequestOrigin(request)) : null;
	const allowedOrigins = new Set<string>(configuredOrigins);
	if (requestServerOrigin) {
		allowedOrigins.add(requestServerOrigin);
	}
	const allowOrigin = requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : null;

	return {
		...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
		...(allowOrigin ? { "access-control-allow-credentials": "true" } : {}),
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
		vary: "origin",
	};
}
