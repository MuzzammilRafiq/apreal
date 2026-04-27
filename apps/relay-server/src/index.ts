/*
HTTP relay server.

Only authenticated HTTP endpoints remain active here.
*/

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_AUTH_PATH,
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	RELAY_CONNECTION_PATH,
	type RelayAgentAuthRequest,
	type RelayAgentAuthResponse,
	type RelayClientAuthRequest,
	type RelayClientAuthResponse,
	type RelayClientHeartbeatResponse,
	type RelayConnectionRequest,
	type RelayConnectionResponse,
	type RelayPrincipalType,
} from "@apreal/shared";
import {
	AuthError,
	readBearerTokenFromRequest,
	readRelayToken,
	type AuthTokenPayload,
	type UserType,
} from "./auth.ts";
import { config } from "dotenv";
import { RelayTokenStore, type StoredRelayToken } from "./token-store.ts";

config();

const DEFAULT_PORT = 3001;
const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;

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

function readStringField(value: unknown, field: string): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readUrlField(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}

		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

function createCorsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": process.env.RELAY_CORS_ALLOW_ORIGIN?.trim() || "*",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
	};
}

function buildHealthPayload(corsHeaders: Record<string, string>) {
	return {
		ok: true,
		service: "relay-server",
		transport: "http",
		timestamp: new Date().toISOString(),
		auth: {
			jwtSecretConfigured: Boolean(process.env.JWT_SECRET?.trim()),
			corsAllowOrigin: corsHeaders["access-control-allow-origin"],
		},
		endpoints: {
			base: "/",
			health: "/health",
			clientHeartbeat: RELAY_CLIENT_HEARTBEAT_PATH,
			clientStream: CLIENT_EVENT_STREAM_PATH,
			clientMessage: CLIENT_MESSAGE_PATH,
			clientAuth: RELAY_CLIENT_AUTH_PATH,
			agentAuth: RELAY_AGENT_AUTH_PATH,
			connection: RELAY_CONNECTION_PATH,
		},
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

function readOptionalBearerToken(headerValue: string | string[] | undefined): string | null {
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

function readClientTokenFromProxyRequest(request: IncomingMessage): string {
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

async function parseClientAuthRequest(request: IncomingMessage): Promise<RelayClientAuthRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const clientId = readStringField(value.clientId, "clientId");
	const clientKey = readStringField(value.clientKey, "clientKey");
	if (!clientId || !clientKey) {
		return null;
	}

	return { clientId, clientKey };
}

async function parseAgentAuthRequest(request: IncomingMessage): Promise<RelayAgentAuthRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const agentId = readStringField(value.agentId, "agentId");
	const agentKey = readStringField(value.agentKey, "agentKey");
	const serverUrl = readUrlField(value.serverUrl);
	if (!agentId || !agentKey) {
		return null;
	}

	const pairingCode =
		value.pairingCode === undefined || value.pairingCode === null ? null : readStringField(value.pairingCode, "pairingCode");

	return {
		agentId,
		agentKey,
		...(serverUrl ? { serverUrl } : {}),
		pairingCode,
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

function resolveTargetFromPayload(payload: AuthTokenPayload): RelayPrincipalType {
	return payload.type === "client" ? "agent" : "client";
}

function shouldRefreshToken(entry: StoredRelayToken): boolean {
	return entry.payload.exp * 1000 - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

function resolveClientProxyTarget(request: IncomingMessage, tokenStore: RelayTokenStore) {
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

	const serverUrl = tokenStore.findAgentServerUrl(principal.targetId);
	if (!serverUrl) {
		throw new AuthError("paired agent route unavailable");
	}

	return {
		clientToken,
		clientId: principal.id,
		agentId: principal.targetId,
		serverUrl,
	};
}

function mapRelayProxyErrorStatus(error: unknown): number {
	const message = getErrorMessage(error);
	if (message === "paired agent route unavailable") {
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

async function forwardBufferedResponse(
	upstreamResponse: Response,
	response: ServerResponse,
	corsHeaders: Record<string, string>,
) {
	const body = Buffer.from(await upstreamResponse.arrayBuffer());
	response.statusCode = upstreamResponse.status;
	setHeaders(response, {
		...corsHeaders,
		...(upstreamResponse.headers.get("content-type")
			? { "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream" }
			: {}),
		...(upstreamResponse.headers.get("cache-control")
			? { "cache-control": upstreamResponse.headers.get("cache-control") ?? "no-store" }
			: {}),
	});
	response.end(body);
}

async function proxyClientMessageRequest(
	request: IncomingMessage,
	response: ServerResponse,
	corsHeaders: Record<string, string>,
	tokenStore: RelayTokenStore,
) {
	const target = resolveClientProxyTarget(request, tokenStore);
	const upstreamUrl = new URL(CLIENT_MESSAGE_PATH, target.serverUrl);
	const body = await readRequestBody(request);

	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(upstreamUrl, {
			method: "POST",
			headers: {
				authorization: `Bearer ${target.clientToken}`,
				"content-type": request.headers["content-type"]?.toString() || "application/json",
			},
			body,
		});
	} catch (error) {
		log("warn", "relay message proxy failed", {
			clientId: target.clientId,
			agentId: target.agentId,
			serverUrl: target.serverUrl,
			error: getErrorMessage(error),
		});
		sendJson(response, 502, { message: "relay could not reach the paired server" }, corsHeaders);
		return;
	}

	await forwardBufferedResponse(upstreamResponse, response, corsHeaders);
}

async function proxyClientStreamRequest(
	request: IncomingMessage,
	response: ServerResponse,
	corsHeaders: Record<string, string>,
	tokenStore: RelayTokenStore,
) {
	const target = resolveClientProxyTarget(request, tokenStore);
	const upstreamUrl = new URL(CLIENT_EVENT_STREAM_PATH, target.serverUrl);
	upstreamUrl.searchParams.set("token", target.clientToken);

	const abortController = new AbortController();
	request.on("close", () => {
		abortController.abort();
	});

	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(upstreamUrl, {
			method: "GET",
			headers: {
				accept: "text/event-stream",
			},
			signal: abortController.signal,
		});
	} catch (error) {
		log("warn", "relay stream proxy failed", {
			clientId: target.clientId,
			agentId: target.agentId,
			serverUrl: target.serverUrl,
			error: getErrorMessage(error),
		});
		sendJson(response, 502, { message: "relay could not reach the paired server" }, corsHeaders);
		return;
	}

	const upstreamContentType = upstreamResponse.headers.get("content-type") ?? "";
	if (!upstreamContentType.toLowerCase().includes("text/event-stream") || !upstreamResponse.body) {
		await forwardBufferedResponse(upstreamResponse, response, corsHeaders);
		return;
	}

	response.statusCode = upstreamResponse.status;
	setHeaders(response, {
		...corsHeaders,
		"content-type": upstreamContentType,
		"cache-control": upstreamResponse.headers.get("cache-control") ?? "no-store",
		connection: upstreamResponse.headers.get("connection") ?? "keep-alive",
		"x-accel-buffering": upstreamResponse.headers.get("x-accel-buffering") ?? "no",
	});

	const upstreamStream = Readable.fromWeb(upstreamResponse.body as globalThis.ReadableStream<Uint8Array>);
	upstreamStream.on("error", (error) => {
		log("warn", "relay sse stream pipeline failed", {
			clientId: target.clientId,
			agentId: target.agentId,
			serverUrl: target.serverUrl,
			error: getErrorMessage(error),
		});
		if (!response.writableEnded) {
			response.destroy(error instanceof Error ? error : undefined);
		}
	});
	upstreamStream.pipe(response);
}

function buildClientAuthResponse(entry: StoredRelayToken): RelayClientAuthResponse {
	return {
		clientId: entry.payload.id,
		clientKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		pairingCode: entry.payload.targetId ? null : entry.payload.pairingCode ?? null,
		target: entry.payload.targetId
			? {
				id: entry.payload.targetId,
				type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
			}
			: null,
		paired: Boolean(entry.payload.targetId),
	};
}

function buildClientHeartbeatResponse(
	entry: StoredRelayToken,
	tokenStore: RelayTokenStore,
): RelayClientHeartbeatResponse {
	const targetId = entry.payload.targetId ?? null;
	const serverReady = Boolean(
		targetId && tokenStore.findLatestByPrincipalId("agent", targetId, { allowExpired: false }),
	);
	const transportReady = Boolean(targetId && tokenStore.findAgentServerUrl(targetId));

	return {
		...buildClientAuthResponse(entry),
		serverReady,
		transportReady,
	};
}

function buildAgentAuthResponse(entry: StoredRelayToken): RelayAgentAuthResponse {
	return {
		agentId: entry.payload.id,
		agentKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		target: {
			id: entry.payload.targetId ?? "",
			type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
		},
		paired: true,
	};
}

export function runRelayServer(options?: { port?: number }) {
	const port = options?.port ?? parsePort(process.env.PORT);
	const tokenStore = new RelayTokenStore();
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders();

		if (pathname === "/" || pathname === "/health") {
			sendJson(response, 200, buildHealthPayload(corsHeaders), corsHeaders);
			return;
		}

		if (pathname === RELAY_CLIENT_AUTH_PATH) {
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

			const clientAuthRequest = await parseClientAuthRequest(request);
			if (!clientAuthRequest) {
				sendJson(response, 400, { message: "Invalid client auth request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"client",
					clientAuthRequest.clientId,
					clientAuthRequest.clientKey,
					{ allowExpired: true },
				);
				if (issuedToken && shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.targetId ? undefined : issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
					});
				}

				if (!issuedToken) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: clientAuthRequest.clientId,
						key: clientAuthRequest.clientKey,
						pairingCode: tokenStore.createPairingCode(),
					});
				}

				log("info", "issued client auth token", {
					clientId: issuedToken.payload.id,
					paired: Boolean(issuedToken.payload.targetId),
				});
				sendJson(response, 200, buildClientAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "client auth failed";
				log("warn", "client auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_CLIENT_HEARTBEAT_PATH) {
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

			const clientHeartbeatRequest = await parseClientAuthRequest(request);
			if (!clientHeartbeatRequest) {
				sendJson(response, 400, { message: "Invalid relay heartbeat request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"client",
					clientHeartbeatRequest.clientId,
					clientHeartbeatRequest.clientKey,
					{ allowExpired: true },
				);
				if (!issuedToken) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: clientHeartbeatRequest.clientId,
						key: clientHeartbeatRequest.clientKey,
						pairingCode: tokenStore.createPairingCode(),
					});
				} else if (shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.targetId ? undefined : issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
					});
				}

				sendJson(response, 200, buildClientHeartbeatResponse(issuedToken, tokenStore), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "relay heartbeat failed";
				log("warn", "relay heartbeat failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_AUTH_PATH) {
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

			const agentAuthRequest = await parseAgentAuthRequest(request);
			if (!agentAuthRequest) {
				sendJson(response, 400, { message: "Invalid agent auth request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"agent",
					agentAuthRequest.agentId,
					agentAuthRequest.agentKey,
					{ allowExpired: true },
				);
				if (agentAuthRequest.pairingCode) {
					const pairedClient = tokenStore.findPendingClientByPairingCode(agentAuthRequest.pairingCode);
					if (!pairedClient) {
						sendJson(response, 404, { message: "Pairing code was not found." }, corsHeaders);
						return;
					}

					const previousClient = tokenStore.findLatestClientByTargetId(agentAuthRequest.agentId, {
						allowExpired: true,
					});
					if (previousClient && previousClient.payload.id !== pairedClient.payload.id) {
						tokenStore.clearClientTarget(previousClient);
					}

					tokenStore.issueToken({
						type: "client",
						id: pairedClient.payload.id,
						key: pairedClient.payload.key,
						targetId: agentAuthRequest.agentId,
						targetType: "agent",
						pairingCode: pairedClient.payload.pairingCode,
					});

					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: agentAuthRequest.agentId,
						key: agentAuthRequest.agentKey,
						targetId: pairedClient.payload.id,
						targetType: "client",
						pairingCode: pairedClient.payload.pairingCode,
						serverUrl: agentAuthRequest.serverUrl ?? issuedToken?.payload.serverUrl,
					});
				}
				if (
					issuedToken &&
					!agentAuthRequest.pairingCode &&
					(shouldRefreshToken(issuedToken) || issuedToken.payload.serverUrl !== agentAuthRequest.serverUrl)
				) {
					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
						serverUrl: agentAuthRequest.serverUrl ?? issuedToken.payload.serverUrl,
					});
				}

				if (!issuedToken) {
					if (!agentAuthRequest.pairingCode) {
						sendJson(response, 400, { message: "Pairing code is required for first-time agent auth." }, corsHeaders);
						return;
					}

					const pairedClient = tokenStore.findPendingClientByPairingCode(agentAuthRequest.pairingCode);
					if (!pairedClient) {
						sendJson(response, 404, { message: "Pairing code was not found." }, corsHeaders);
						return;
					}

					tokenStore.issueToken({
						type: "client",
						id: pairedClient.payload.id,
						key: pairedClient.payload.key,
						targetId: agentAuthRequest.agentId,
						targetType: "agent",
						pairingCode: pairedClient.payload.pairingCode,
					});

					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: agentAuthRequest.agentId,
						key: agentAuthRequest.agentKey,
						targetId: pairedClient.payload.id,
						targetType: "client",
						pairingCode: pairedClient.payload.pairingCode,
						serverUrl: agentAuthRequest.serverUrl,
					});
				}

				log("info", "issued agent auth token", {
					agentId: issuedToken.payload.id,
					targetId: issuedToken.payload.targetId,
					serverUrl: issuedToken.payload.serverUrl,
				});
				sendJson(response, 200, buildAgentAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "agent auth failed";
				log("warn", "agent auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === CLIENT_EVENT_STREAM_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "GET") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			try {
				await proxyClientStreamRequest(request, response, corsHeaders, tokenStore);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay stream request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === CLIENT_MESSAGE_PATH) {
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

			try {
				await proxyClientMessageRequest(request, response, corsHeaders, tokenStore);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay message request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
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
				const token = readBearerTokenFromRequest(request);
				if (!tokenStore.findActiveToken(token)) {
					throw new AuthError("unknown token");
				}

				const principal = readRelayToken(token);
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
