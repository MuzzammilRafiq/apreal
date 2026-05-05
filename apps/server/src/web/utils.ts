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

export function createCorsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"access-control-allow-headers": "authorization, content-type, x-pi-local-client-id",
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

export function isLoopbackClientRequest(request: Request): boolean {
	const remoteAddress = getRequestRemoteAddress(request);
	return remoteAddress ? isLoopbackAddress(remoteAddress) : false;
}

export function isDirectExecution(moduleUrl: string) {
	const entryPoint = process.argv[1];
	return typeof entryPoint === "string" && fileURLToPath(moduleUrl) === entryPoint;
}
