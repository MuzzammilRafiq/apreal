/*
HTTP relay server.

Only authenticated HTTP endpoints remain active here.
*/

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_AUTH_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	RELAY_CONNECTION_PATH,
	type RelayAgentCommand,
	type RelayAgentAuthRequest,
	type RelayAgentAuthResponse,
	type RelayAgentMessage,
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
const RELAY_SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;

type LogLevel = "info" | "warn" | "error";

type RelayBrowserClientConnection = {
	clientId: string;
	agentId: string;
	closed: boolean;
	send(payload: unknown): boolean;
	close(reason: string): void;
};

type RelayAgentConnection = {
	agentId: string;
	closed: boolean;
	send(command: RelayAgentCommand): boolean;
	close(reason: string): void;
};

const ANSI_RESET = "\x1b[0m";
const TIMESTAMP_COLOR = "\x1b[90m";
const DATA_COLOR = "\x1b[96m";
const LEVEL_COLORS: Record<LogLevel, string> = {
	info: "\x1b[92m",
	warn: "\x1b[93m",
	error: "\x1b[91m",
};
const TAG_COLORS = ["\x1b[95m", "\x1b[96m", "\x1b[94m", "\x1b[92m", "\x1b[93m", "\x1b[36m"] as const;

function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

function supportsColor(): boolean {
	if (process.env.NO_COLOR) {
		return false;
	}

	return Boolean(process.stdout.isTTY);
}

function colorize(value: string, color: string): string {
	if (!supportsColor()) {
		return value;
	}

	return `${color}${value}${ANSI_RESET}`;
}

function pickTagColor(tag: string): string {
	let hash = 0;
	for (let index = 0; index < tag.length; index += 1) {
		hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
	}

	return TAG_COLORS[hash % TAG_COLORS.length] ?? "\x1b[95m";
}

function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
	const tag = "relay-server";
	const serializedFields = fields ? ` ${JSON.stringify(fields)}` : "";
	const timestamp = colorize(new Date().toISOString(), TIMESTAMP_COLOR);
	const levelLabel = colorize(level.toUpperCase(), LEVEL_COLORS[level]);
	const tagLabel = colorize(`[${tag}]`, pickTagColor(tag));
	const dataLabel = colorize(`${message}${serializedFields}`, DATA_COLOR);
	const line = `${timestamp} ${levelLabel} ${tagLabel} ${dataLabel}`;

	if (level === "error") {
		console.error(line);
		return;
	}

	if (level === "warn") {
		console.warn(line);
		return;
	}

	console.log(line);
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

function buildHealthPayload(corsHeaders: Record<string, string>, tokenStore: RelayTokenStore) {
	return {
		ok: true,
		service: "relay-server",
		transport: "http",
		timestamp: new Date().toISOString(),
		auth: {
			jwtSecretConfigured: Boolean(process.env.JWT_SECRET?.trim()),
			corsAllowOrigin: corsHeaders["access-control-allow-origin"],
		},
		storage: {
			tokenStorePath: tokenStore.getFilePath(),
			tokenCount: tokenStore.countTokens({ allowExpired: true }),
			activeTokenCount: tokenStore.countTokens({ allowExpired: false }),
		},
		endpoints: {
			base: "/",
			health: "/health",
			clientHeartbeat: RELAY_CLIENT_HEARTBEAT_PATH,
			clientStream: CLIENT_EVENT_STREAM_PATH,
			clientMessage: CLIENT_MESSAGE_PATH,
			clientAuth: RELAY_CLIENT_AUTH_PATH,
			agentAuth: RELAY_AGENT_AUTH_PATH,
			agentStream: RELAY_AGENT_STREAM_PATH,
			agentMessage: RELAY_AGENT_MESSAGE_PATH,
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

function resolveRequestOrigin(request: IncomingMessage): string | null {
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

function validateAgentServerUrl(request: IncomingMessage, serverUrl?: string) {
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

function resolveClientRelayTarget(request: IncomingMessage, tokenStore: RelayTokenStore) {
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

function mapRelayProxyErrorStatus(error: unknown): number {
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

function createSseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function createSseComment(comment: string): string {
	return `: ${comment}\n\n`;
}

function parseRelayAgentMessage(value: unknown): RelayAgentMessage | null {
	if (!isObjectRecord(value) || value.type !== "server_message") {
		return null;
	}

	const clientId = readStringField(value.clientId, "clientId");
	if (!clientId) {
		return null;
	}

	return {
		type: "server_message",
		clientId,
		message: value.message,
	};
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
	agentConnections: Map<string, RelayAgentConnection>,
): RelayClientHeartbeatResponse {
	const targetId = entry.payload.targetId ?? null;
	const serverReady = Boolean(
		targetId && tokenStore.findLatestByPrincipalId("agent", targetId, { allowExpired: false }),
	);
	const transportReady = Boolean(targetId && agentConnections.get(targetId) && !agentConnections.get(targetId)?.closed);

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
	const browserClients = new Map<string, RelayBrowserClientConnection>();
	const agentConnections = new Map<string, RelayAgentConnection>();

	function listBrowserClientsForAgent(agentId: string): RelayBrowserClientConnection[] {
		return Array.from(browserClients.values()).filter((client) => client.agentId === agentId && !client.closed);
	}

	function sendAgentCommand(agentId: string, command: RelayAgentCommand): boolean {
		const connection = agentConnections.get(agentId);
		if (!connection || connection.closed) {
			return false;
		}

		return connection.send(command);
	}

	function closeBrowserClient(clientId: string, reason: string) {
		const existing = browserClients.get(clientId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	function closeAgentConnection(agentId: string, reason: string) {
		const existing = agentConnections.get(agentId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	function notifyAgentOfConnectedClients(agentId: string) {
		for (const client of listBrowserClientsForAgent(agentId)) {
			sendAgentCommand(agentId, { type: "client_connect", clientId: client.clientId });
		}
	}

	function registerBrowserClientStream(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, tokenStore);
		response.statusCode = 200;
		setHeaders(response, {
			...corsHeaders,
			"cache-control": "no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		});

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = browserClients.get(target.clientId);
			if (existing?.close === close) {
				browserClients.delete(target.clientId);
			}

			sendAgentCommand(target.agentId, {
				type: "client_disconnect",
				clientId: target.clientId,
				reason,
			});

			if (!response.writableEnded) {
				response.end();
			}
		};

		const connection: RelayBrowserClientConnection = {
			clientId: target.clientId,
			agentId: target.agentId,
			closed: false,
			send(payload) {
				if (closed || response.writableEnded) {
					return false;
				}

				try {
					response.write(createSseChunk(payload));
					return true;
				} catch {
					close("browser_stream_write_failed");
					return false;
				}
			},
			close,
		};

		const existing = browserClients.get(target.clientId);
		if (existing) {
			existing.close("browser_stream_replaced");
		}

		browserClients.set(target.clientId, connection);
		response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				response.write(createSseComment("ping"));
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			close("browser_stream_closed");
		});

		sendAgentCommand(target.agentId, { type: "client_connect", clientId: target.clientId });
		log("info", "relay browser stream connected", {
			clientId: target.clientId,
			agentId: target.agentId,
			browserClients: browserClients.size,
		});
	}

	async function handleClientMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, tokenStore);
		const browserClient = browserClients.get(target.clientId);
		if (!browserClient || browserClient.closed) {
			throw new AuthError("browser client stream is not connected");
		}

		if (!sendAgentCommand(target.agentId, {
			type: "client_message",
			clientId: target.clientId,
			message: JSON.parse(await readRequestBody(request)),
		})) {
			throw new AuthError("paired agent transport unavailable");
		}

		sendJson(response, 202, { ok: true }, corsHeaders);
	}

	function handleAgentStreamRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		if (!tokenStore.findActiveToken(token)) {
			throw new AuthError("unknown token");
		}

		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may open relay agent transport");
		}

		response.statusCode = 200;
		setHeaders(response, {
			...corsHeaders,
			"cache-control": "no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		});

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = agentConnections.get(principal.id);
			if (existing?.close === close) {
				agentConnections.delete(principal.id);
			}

			for (const client of listBrowserClientsForAgent(principal.id)) {
				client.close(reason);
			}

			if (!response.writableEnded) {
				response.end();
			}
		};

		const connection: RelayAgentConnection = {
			agentId: principal.id,
			closed: false,
			send(command) {
				if (closed || response.writableEnded) {
					return false;
				}

				try {
					response.write(createSseChunk(command));
					return true;
				} catch {
					close("agent_stream_write_failed");
					return false;
				}
			},
			close,
		};

		const existing = agentConnections.get(principal.id);
		if (existing) {
			existing.close("agent_stream_replaced");
		}

		agentConnections.set(principal.id, connection);
		response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				response.write(createSseComment("ping"));
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			close("agent_stream_closed");
		});

		notifyAgentOfConnectedClients(principal.id);
		log("info", "relay agent stream connected", {
			agentId: principal.id,
			agentConnections: agentConnections.size,
		});
	}

	async function handleAgentMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		if (!tokenStore.findActiveToken(token)) {
			throw new AuthError("unknown token");
		}

		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may post relay agent messages");
		}

		const payload = parseRelayAgentMessage(JSON.parse(await readRequestBody(request)));
		if (!payload) {
			sendJson(response, 400, { message: "Invalid relay agent message payload." }, corsHeaders);
			return;
		}

		const client = browserClients.get(payload.clientId);
		if (!client || client.closed || client.agentId !== principal.id) {
			sendJson(response, 409, { message: "Browser client stream is not connected." }, corsHeaders);
			return;
		}

		client.send(payload.message);
		sendJson(response, 202, { ok: true }, corsHeaders);
	}
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders();

		if (pathname === "/" || pathname === "/health") {
			sendJson(response, 200, buildHealthPayload(corsHeaders, tokenStore), corsHeaders);
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

				sendJson(response, 200, buildClientHeartbeatResponse(issuedToken, tokenStore, agentConnections), corsHeaders);
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
					});
				}
				if (issuedToken && !agentAuthRequest.pairingCode && shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
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
					});
				}

				log("info", "issued agent auth token", {
					agentId: issuedToken.payload.id,
					targetId: issuedToken.payload.targetId,
					connected: Boolean(agentConnections.get(issuedToken.payload.id)),
				});
				sendJson(response, 200, buildAgentAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "agent auth failed";
				log("warn", "agent auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_STREAM_PATH) {
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
				handleAgentStreamRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may open relay agent transport" ? 403 : 401;
				log("warn", "relay agent stream rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_MESSAGE_PATH) {
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
				await handleAgentMessageRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may post relay agent messages" ? 403 : 401;
				log("warn", "relay agent message rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
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
				registerBrowserClientStream(request, response, corsHeaders);
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
				await handleClientMessageRequest(request, response, corsHeaders);
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
		tokenStorePath: tokenStore.getFilePath(),
		tokenCount: tokenStore.countTokens({ allowExpired: true }),
	});

	return server;
}

runRelayServer();
