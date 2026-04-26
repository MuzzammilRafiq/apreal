/*
HTTP relay server.

Only authenticated HTTP endpoints remain active here.
*/

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
	RELAY_CONNECTION_PATH,
	type RelayConnectionRequest,
	type RelayConnectionResponse,
	type RelayPrincipalType,
} from "@apreal/shared";
import {
	AuthError,
	authenticateHttpRequest,
	type AuthTokenPayload,
	type UserType,
} from "./auth.ts";
import { config } from "dotenv";

config();

const DEFAULT_PORT = 3001;

type LogLevel = "info" | "warn" | "error";

function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
	const line = `${new Date().toISOString()} ${level.toUpperCase()} [relay-server] ${message}`;
	const serializedFields = fields ? ` ${JSON.stringify(fields)}` : "";

	if (level === "error") {
		console.error(`${line}${serializedFields}`);
		return;
	}

	if (level === "warn") {
		console.warn(`${line}${serializedFields}`);
		return;
	}

	console.log(`${line}${serializedFields}`);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createCorsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": process.env.RELAY_CORS_ALLOW_ORIGIN?.trim() || "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
	};
}

function setHeaders(response: ServerResponse, headers: Record<string, string>) {
	for (const [key, value] of Object.entries(headers)) {
		response.setHeader(key, value);
	}
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown, headers?: Record<string, string>) {
	const body = JSON.stringify(payload);
	response.statusCode = statusCode;
	response.setHeader("content-type", "application/json");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, body: string, headers?: Record<string, string>) {
	response.statusCode = statusCode;
	response.setHeader("content-type", "text/plain; charset=utf-8");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";

		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			resolve(body);
		});
		request.on("error", reject);
	});
}

async function parseRelayConnectionRequest(request: IncomingMessage): Promise<RelayConnectionRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.targetId !== "string") {
		return null;
	}

	if (value.targetType !== undefined && value.targetType !== "agent" && value.targetType !== "client") {
		return null;
	}

	return {
		targetId: value.targetId.trim(),
		targetType: value.targetType,
	};
}

function getDefaultTargetType(type: UserType): RelayPrincipalType {
	return type === "client" ? "agent" : "client";
}

function authorizeRelayConnection(
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

function mapRelayConnectionErrorStatus(error: unknown): number {
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

export function runRelayServer(options?: { port?: number }) {
	const port = options?.port ?? parsePort(process.env.PORT);
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders();

		if (pathname === "/health") {
			sendJson(response, 200, {
				ok: true,
				service: "relay-server",
				transport: "http",
			});
			return;
		}

		if (pathname === RELAY_CONNECTION_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			const connectionRequest = await parseRelayConnectionRequest(request);
			if (!connectionRequest) {
				sendJson(response, 400, { message: "Invalid relay connection request." }, corsHeaders);
				return;
			}

			try {
				const principal = authenticateHttpRequest(request);
				const payload = authorizeRelayConnection(principal, connectionRequest);
				log("info", "authenticated relay http connection", {
					principalId: payload.principal.id,
					principalType: payload.principal.type,
					targetId: payload.target.id,
					targetType: payload.target.type,
					scopedToTarget: payload.principal.scopedToTarget,
				});
				sendJson(response, 200, payload, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayConnectionErrorStatus(error);
				const message = error instanceof Error ? error.message : "relay connection authorization failed";
				log("warn", "relay http connection rejected", {
					error: message,
				});
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		sendText(response, 404, "Not Found", corsHeaders);
	});

	server.listen(port);

	log("info", "relay server listening", {
		port,
		transport: "http",
	});

	return server;
}

if (import.meta.main) {
	runRelayServer();
}
