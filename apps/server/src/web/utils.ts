import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type RelayAgentCommand,
} from "@apreal/shared";
import type {
	SessionSummary,
	TranscriptMessage,
} from "./session-state.ts";
import { getServerEnv } from "../env.ts";
import type { ServerAppMessage } from "../protocol.ts";

export const DEFAULT_PORT = 3000;
export const DEFAULT_SESSION_PAGE_LIMIT = 50;
export const MAX_SESSION_PAGE_LIMIT = 200;
export const SERVER_SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WORKSPACE_ROOT = join(SERVER_SRC_DIR, "..", "..", "..");
export const RELAY_STREAM_RETRY_MS = 1_000;
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
export const SSE_ENCODER = new TextEncoder();

export type ClientTransport = "http" | "relay";

export type ServerMessage = ServerAppMessage<SessionSummary, TranscriptMessage>;

export type ClientConnection = {
	clientId: string;
	closed: boolean;
	ready: boolean;
	transport: ClientTransport;
	send(payload: ServerMessage): boolean | void;
	close?(reason: string): void;
};

export {
	type SessionSummary,
	type SharedSessionState,
	type TranscriptMessage,
	type TranscriptMessageSegment,
	type TranscriptTextSegment,
	type TranscriptThinkingSegment,
	type TranscriptToolCall,
	type TranscriptToolCallSegment,
} from "./session-state.ts";

export function parseRelayAgentCommand(rawMessage: string): RelayAgentCommand | null {
	let value: unknown;
	try {
		value = JSON.parse(rawMessage);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.type !== "string" || typeof value.clientId !== "string") {
		return null;
	}

	if (value.type === "client_connect") {
		return {
			type: "client_connect",
			clientId: value.clientId,
		};
	}

	if (value.type === "client_disconnect") {
		return {
			type: "client_disconnect",
			clientId: value.clientId,
			reason: typeof value.reason === "string" ? value.reason : undefined,
		};
	}

	if (value.type === "client_message") {
		return {
			type: "client_message",
			clientId: value.clientId,
			message: value.message,
		};
	}

	return null;
}

export function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

export function mergeResponseHeaders(headers?: ResponseInit["headers"]): Record<string, string> {
	const mergedHeaders: Record<string, string> = {
		"cache-control": "no-store",
	};

	if (!headers) {
		return mergedHeaders;
	}

	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			mergedHeaders[key] = value;
		});
		return mergedHeaders;
	}

	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			mergedHeaders[key] = value;
		}
		return mergedHeaders;
	}

	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "undefined") {
			continue;
		}

		mergedHeaders[key] = Array.isArray(value) ? value.join(", ") : `${value}`;
	}

	return mergedHeaders;
}

export function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		...init,
		headers: mergeResponseHeaders(init?.headers),
	});
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOrigin(value: string | null | undefined): string | null {
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

function readConfiguredCorsOrigins(): string[] {
	const env = getServerEnv();
	return [env.APREAL_CORS_ALLOW_ORIGINS, env.APREAL_CORS_ALLOW_ORIGIN]
		.flatMap((value) => (value ?? "").split(","))
		.map((value) => normalizeOrigin(value))
		.filter((value): value is string => value !== null);
}

function buildAllowedCorsOrigins(request?: Request): Set<string> {
	const origins = new Set<string>([
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:4173",
		"http://127.0.0.1:4173",
		...readConfiguredCorsOrigins(),
	]);
	const requestOrigin = request ? normalizeOrigin(new URL(request.url).origin) : null;
	if (requestOrigin) {
		origins.add(requestOrigin);
	}

	return origins;
}

function resolveAllowedCorsOrigin(request?: Request): string | null {
	const requestOrigin = normalizeOrigin(request?.headers.get("origin"));
	if (!requestOrigin) {
		return null;
	}

	return buildAllowedCorsOrigins(request).has(requestOrigin) ? requestOrigin : null;
}

export function getCorsOriginErrorMessage(request?: Request): string | null {
	const requestOrigin = normalizeOrigin(request?.headers.get("origin"));
	if (!requestOrigin) {
		return null;
	}

	return resolveAllowedCorsOrigin(request)
		? null
		: `Browser origin ${requestOrigin} is not allowed to access this API.`;
}

export function createCorsHeaders(request?: Request): Record<string, string> {
	const allowOrigin = resolveAllowedCorsOrigin(request);
	return {
		...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
		"access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"access-control-allow-headers": "authorization, content-type, x-pi-local-client-id",
		vary: "origin",
	};
}

export function getRequestRemoteAddress(request: Request): string | null {
	const remoteAddress = request.headers.get("x-pi-remote-address")?.trim();
	return remoteAddress || null;
}

export function isLoopbackAddress(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === "::1" || normalized === "127.0.0.1" || normalized === "::ffff:127.0.0.1";
}

function normalizeIpAddress(value: string): string {
	const normalized = value.trim().toLowerCase();
	return normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
}

export function isPrivateNetworkAddress(value: string): boolean {
	const normalized = normalizeIpAddress(value);

	if (normalized === "localhost" || isLoopbackAddress(normalized)) {
		return true;
	}

	if (isIP(normalized) === 4) {
		if (normalized.startsWith("10.") || normalized.startsWith("192.168.")) {
			return true;
		}

		if (normalized.startsWith("172.")) {
			const [, secondOctet = ""] = normalized.split(".");
			const secondOctetNumber = Number.parseInt(secondOctet, 10);
			return secondOctetNumber >= 16 && secondOctetNumber <= 31;
		}

		return normalized.startsWith("169.254.");
	}

	if (isIP(normalized) === 6) {
		return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
	}

	return false;
}

export function isLoopbackClientRequest(request: Request): boolean {
	const remoteAddress = getRequestRemoteAddress(request);
	return remoteAddress ? isLoopbackAddress(remoteAddress) : false;
}

export function isPrivateNetworkClientRequest(request: Request): boolean {
	const remoteAddress = getRequestRemoteAddress(request);
	return remoteAddress ? isPrivateNetworkAddress(remoteAddress) : false;
}

export function isDirectExecution(moduleUrl: string) {
	const entryPoint = process.argv[1];
	return typeof entryPoint === "string" && fileURLToPath(moduleUrl) === entryPoint;
}
