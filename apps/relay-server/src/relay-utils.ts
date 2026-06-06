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

config({ path: ".env.local" });
config();


export const DEFAULT_PORT = 3001;
export const RELAY_SSE_HEARTBEAT_INTERVAL_MS = 15_000;
export const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;

export type LogLevel = "info" | "warn" | "error";

export type RelayBrowserClientConnection = {
	clientId: string;
	agentId: string;
	closed: boolean;
	send(payload: unknown): boolean;
	close(reason: string): void;
};

export type RelayAgentConnection = {
	agentId: string;
	closed: boolean;
	send(command: RelayAgentCommand): boolean;
	close(reason: string): void;
};

export const ANSI_RESET = "\x1b[0m";
export const TIMESTAMP_COLOR = "\x1b[90m";
export const DATA_COLOR = "\x1b[96m";
export const LEVEL_COLORS: Record<LogLevel, string> = {
	info: "\x1b[92m",
	warn: "\x1b[93m",
	error: "\x1b[91m",
};
export const TAG_COLORS = ["\x1b[95m", "\x1b[96m", "\x1b[94m", "\x1b[92m", "\x1b[93m", "\x1b[36m"] as const;

export function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

export function supportsColor(): boolean {
	if (process.env.NO_COLOR) {
		return false;
	}

	return Boolean(process.stdout.isTTY);
}

export function colorize(value: string, color: string): string {
	if (!supportsColor()) {
		return value;
	}

	return `${color}${value}${ANSI_RESET}`;
}

export function pickTagColor(tag: string): string {
	let hash = 0;
	for (let index = 0; index < tag.length; index += 1) {
		hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
	}

	return TAG_COLORS[hash % TAG_COLORS.length] ?? "\x1b[95m";
}

export function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
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

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringField(value: unknown, field: string): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function readUrlField(value: unknown): string | null {
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

export function createCorsHeaders(request?: IncomingMessage): Record<string, string> {
	const configuredOrigin = process.env.RELAY_CORS_ALLOW_ORIGIN?.trim();
	const requestOrigin = typeof request?.headers.origin === "string" ? request.headers.origin.trim() : "";

	return {
		"access-control-allow-origin": configuredOrigin || requestOrigin || "*",
		"access-control-allow-credentials": "true",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
	};
}

export function buildHealthPayload(corsHeaders: Record<string, string>, tokenStore: RelayTokenStore) {
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

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function readOptionalBearerToken(headerValue: string | string[] | undefined): string | null {
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

export function readClientTokenFromProxyRequest(request: IncomingMessage): string {
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

export function setHeaders(response: ServerResponse, headers: Record<string, string>) {
	for (const [key, value] of Object.entries(headers)) {
		response.setHeader(key, value);
	}
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown, headers?: Record<string, string>) {
	const body = JSON.stringify(payload);
	response.statusCode = statusCode;
	response.setHeader("content-type", "application/json");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

export function sendText(response: ServerResponse, statusCode: number, body: string, headers?: Record<string, string>) {
	response.statusCode = statusCode;
	response.setHeader("content-type", "text/plain; charset=utf-8");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

export function readRequestBody(request: IncomingMessage): Promise<string> {
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

export async function parseRelayConnectionRequest(request: IncomingMessage): Promise<RelayConnectionRequest | null> {
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

export async function parseClientAuthRequest(request: IncomingMessage): Promise<RelayClientAuthRequest | null> {
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

	const ownerGrant =
		value.ownerGrant === undefined || value.ownerGrant === null ? null : readStringField(value.ownerGrant, "ownerGrant");

	return { clientId, clientKey, ownerGrant };
}

export async function parseAgentAuthRequest(request: IncomingMessage): Promise<RelayAgentAuthRequest | null> {
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

	const ownerGrant =
		value.ownerGrant === undefined || value.ownerGrant === null ? null : readStringField(value.ownerGrant, "ownerGrant");

	return {
		agentId,
		agentKey,
		...(serverUrl ? { serverUrl } : {}),
		ownerGrant,
	};
}

export function getDefaultTargetType(type: UserType): RelayPrincipalType {
	return type === "client" ? "agent" : "client";
}

export function authorizeRelayConnection(
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

export function mapRelayConnectionErrorStatus(error: unknown): number {
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

export function resolveTargetFromPayload(payload: AuthTokenPayload): RelayPrincipalType {
	return payload.type === "client" ? "agent" : "client";
}

export function shouldRefreshToken(entry: StoredRelayToken): boolean {
	return entry.payload.exp * 1000 - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
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

export function validateAgentServerUrl(request: IncomingMessage, serverUrl?: string) {
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

export function resolveClientRelayTarget(request: IncomingMessage, tokenStore: RelayTokenStore) {
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

export function mapRelayProxyErrorStatus(error: unknown): number {
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

export function createSseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

export function createSseComment(comment: string): string {
	return `: ${comment}\n\n`;
}

export function parseRelayAgentMessage(value: unknown): RelayAgentMessage | null {
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

export function buildClientAuthResponse(entry: StoredRelayToken): RelayClientAuthResponse {
	return {
		clientId: entry.payload.id,
		clientKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		target: entry.payload.targetId
			? {
				id: entry.payload.targetId,
				type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
			}
			: null,
		paired: Boolean(entry.payload.targetId),
	};
}

export function buildClientHeartbeatResponse(
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

export function buildAgentAuthResponse(entry: StoredRelayToken): RelayAgentAuthResponse {
	return {
		agentId: entry.payload.id,
		agentKey: entry.payload.key,
		token: entry.token,
		expiresAt: entry.payload.exp * 1000,
		target: entry.payload.targetId
			? {
				id: entry.payload.targetId,
				type: entry.payload.targetType ?? resolveTargetFromPayload(entry.payload),
			}
			: null,
		paired: Boolean(entry.payload.targetId || entry.payload.ownerUserId),
	};
}
