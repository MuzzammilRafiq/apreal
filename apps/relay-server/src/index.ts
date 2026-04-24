import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
	RELAY_ALLOWED_ACTIONS,
	RELAY_BOOTSTRAP_PATH,
	RELAY_BROWSER_PROTOCOL,
	isRelayAllowedAction,
	normalizeRelayPrincipalId,
	type RelayClientBootstrapRequest,
	type RelayClientBootstrapResponse,
	type RelayInboundEnvelope,
	type RelayOutboundEnvelope,
} from "@apreal/shared";
import {
	AuthError,
	authenticateRequest,
	generateToken,
	RELAY_JWT_TTL_MS,
	type AuthTokenPayload,
	type UserType,
} from "./auth.ts";
import { RelayStateStore } from "./state-store.ts";

const DEFAULT_PORT = 3001;

type RelayInboundMessage = RelayInboundEnvelope<Record<string, unknown>>;
type RelayOutboundMessage = RelayOutboundEnvelope<Record<string, unknown>>;

type RelaySocket = WebSocket & {
	user?: AuthTokenPayload;
};

type LogLevel = "info" | "warn" | "error";

const agents = new Map<string, RelaySocket>();
const clients = new Map<string, RelaySocket>();
const stateStore = new RelayStateStore(process.env.RELAY_SQLITE_PATH?.trim() || undefined);

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
		"access-control-allow-headers": "content-type",
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

async function parseRelayBootstrapRequest(request: IncomingMessage): Promise<RelayClientBootstrapRequest | null> {
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

	const clientId = normalizeRelayPrincipalId(value.clientId);
	if (!clientId) {
		return null;
	}

	return { clientId };
}

function getDefaultAgentId(): string | null {
	return (
		normalizeRelayPrincipalId(process.env.RELAY_DEFAULT_AGENT_ID) ??
		normalizeRelayPrincipalId(process.env.PI_RELAY_AGENT_ID)
	);
}

function getForwardedHeader(request: IncomingMessage, name: string): string | null {
	const value = request.headers[name];
	if (Array.isArray(value)) {
		return value[0]?.trim() || null;
	}

	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolvePublicWebSocketUrl(request: IncomingMessage): string {
	const forwardedProtocol = getForwardedHeader(request, "x-forwarded-proto");
	const host = getForwardedHeader(request, "x-forwarded-host") ?? getForwardedHeader(request, "host");
	if (!host) {
		throw new Error("missing host header");
	}

	const protocol = forwardedProtocol === "https" ? "wss" : forwardedProtocol === "http" ? "ws" : "ws";
	return `${protocol}://${host}`;
}

function rawMessageToString(rawMessage: RawData): string {
	if (typeof rawMessage === "string") {
		return rawMessage;
	}

	if (Array.isArray(rawMessage)) {
		return Buffer.concat(rawMessage).toString("utf8");
	}

	if (rawMessage instanceof ArrayBuffer) {
		return Buffer.from(rawMessage).toString("utf8");
	}

	return rawMessage.toString("utf8");
}

function parseRelayMessage(rawMessage: RawData): RelayInboundMessage | null {
	let value: unknown;
	try {
		value = JSON.parse(rawMessageToString(rawMessage));
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	if ((value.type !== "command" && value.type !== "response") || (value.to !== "agent" && value.to !== "client")) {
		return null;
	}

	const targetId = normalizeRelayPrincipalId(value.targetId);
	if (!targetId || !isRelayAllowedAction(value.action) || !isObjectRecord(value.payload)) {
		return null;
	}

	return {
		type: value.type,
		to: value.to,
		targetId,
		action: value.action,
		payload: value.payload,
	};
}

function getRegistry(type: UserType): Map<string, RelaySocket> {
	return type === "agent" ? agents : clients;
}

function closeUnauthorized(socket: RelaySocket) {
	try {
		socket.close(1008, "unauthorized");
	} catch (error) {
		log("warn", "failed to close unauthorized socket", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function sendError(socket: RelaySocket, code: string, message: string) {
	if (socket.readyState !== WebSocket.OPEN) {
		return;
	}

	socket.send(JSON.stringify({ type: "error", code, message }));
}

function markPrincipalConnected(user: AuthTokenPayload) {
	stateStore.upsertPrincipal({
		principalId: user.id,
		principalType: user.type,
		connectionStatus: "online",
		handshakeState: "ready",
		at: Date.now(),
	});
}

function markPrincipalDisconnected(user: AuthTokenPayload) {
	stateStore.markPrincipalDisconnected(user.id, Date.now());
}

function registerConnection(socket: RelaySocket) {
	const user = socket.user;
	if (!user) {
		closeUnauthorized(socket);
		return;
	}

	const registry = getRegistry(user.type);
	const existingSocket = registry.get(user.id);
	if (existingSocket && existingSocket !== socket && existingSocket.readyState === WebSocket.OPEN) {
		existingSocket.close(1008, "replaced");
	}

	registry.set(user.id, socket);
	markPrincipalConnected(user);
	flushQueuedMessages(socket);
	log("info", "authenticated relay connection", {
		id: user.id,
		type: user.type,
	});
}

function cleanupConnection(socket: RelaySocket) {
	const user = socket.user;
	if (!user) {
		return;
	}

	const registry = getRegistry(user.type);
	if (registry.get(user.id) === socket) {
		registry.delete(user.id);
	}

	markPrincipalDisconnected(user);
	log("info", "relay connection closed", {
		id: user.id,
		type: user.type,
	});
}

function isAuthorizedRoute(user: AuthTokenPayload, message: RelayInboundMessage): boolean {
	if (user.type === "client") {
		return message.type === "command" && message.to === "agent";
	}

	if (user.type === "agent") {
		return message.type === "response" && message.to === "client";
	}

	return false;
}

function buildOutboundMessage(user: AuthTokenPayload, message: RelayInboundMessage): RelayOutboundMessage {
	return {
		type: message.type,
		to: message.to,
		targetId: message.targetId,
		action: message.action,
		payload: message.payload,
		fromId: user.id,
		fromType: user.type,
	};
}

function recordPairing(user: AuthTokenPayload, targetId: string) {
	const at = Date.now();
	if (user.type === "client") {
		stateStore.replacePairing({ clientId: user.id, agentId: targetId, at });
		return;
	}

	stateStore.replacePairing({ clientId: targetId, agentId: user.id, at });
}

function deliverEnvelope(target: RelaySocket, envelope: RelayOutboundMessage): boolean {
	if (target.readyState !== WebSocket.OPEN) {
		return false;
	}

	try {
		target.send(JSON.stringify(envelope));
		return true;
	} catch (error) {
		log("error", "failed to forward relay message", {
			fromId: envelope.fromId,
			fromType: envelope.fromType,
			targetId: envelope.targetId,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

function enqueueEnvelope(envelope: RelayOutboundMessage) {
	const metadata = stateStore.enqueueEnvelope(envelope, Date.now());
	log("info", "queued relay message for offline target", {
		id: metadata.id,
		fromId: metadata.fromId,
		fromType: metadata.fromType,
		targetId: metadata.targetId,
		targetType: metadata.targetType,
		action: metadata.action,
	});
}

function flushQueuedMessages(socket: RelaySocket) {
	const user = socket.user;
	if (!user) {
		return;
	}

	const queuedEnvelopes = stateStore.listQueuedEnvelopesForTarget(user.type, user.id);
	if (queuedEnvelopes.length === 0) {
		return;
	}

	for (const queuedEnvelope of queuedEnvelopes) {
		if (!deliverEnvelope(socket, queuedEnvelope.envelope)) {
			break;
		}

		stateStore.deleteQueuedEnvelope(queuedEnvelope.id);
		log("info", "flushed queued relay message", {
			id: queuedEnvelope.id,
			targetId: user.id,
			targetType: user.type,
		});
	}
}

function forwardMessage(socket: RelaySocket, message: RelayInboundMessage) {
	const user = socket.user;
	if (!user) {
		closeUnauthorized(socket);
		return;
	}

	if (!isAuthorizedRoute(user, message)) {
		log("warn", "rejected unauthorized route", {
			fromId: user.id,
			fromType: user.type,
			messageType: message.type,
			to: message.to,
			targetId: message.targetId,
		});
		sendError(socket, "forbidden", "route not allowed for this role");
		return;
	}

	const outboundMessage = buildOutboundMessage(user, message);

	try {
		recordPairing(user, message.targetId);
	} catch (error) {
		log("error", "failed to persist relay pairing", {
			fromId: user.id,
			fromType: user.type,
			targetId: message.targetId,
			error: error instanceof Error ? error.message : String(error),
		});
		sendError(socket, "delivery_failed", "failed to persist pairing state");
		return;
	}

	const target = getRegistry(message.to).get(message.targetId);
	if (!target || target.readyState !== WebSocket.OPEN) {
		try {
			enqueueEnvelope(outboundMessage);
		} catch (error) {
			log("error", "failed to queue relay message", {
				fromId: user.id,
				fromType: user.type,
				targetId: message.targetId,
				error: error instanceof Error ? error.message : String(error),
			});
			sendError(socket, "delivery_failed", "failed to queue message for offline target");
		}
		return;
	}

	if (!deliverEnvelope(target, outboundMessage)) {
		try {
			enqueueEnvelope(outboundMessage);
		} catch (error) {
			log("error", "failed to queue relay message after live delivery failure", {
				fromId: user.id,
				fromType: user.type,
				targetId: message.targetId,
				error: error instanceof Error ? error.message : String(error),
			});
			sendError(socket, "delivery_failed", "failed to deliver or queue message");
		}
	}
}

function handleMessage(socket: RelaySocket, rawMessage: RawData) {
	const message = parseRelayMessage(rawMessage);
	if (!message) {
		const user = socket.user;
		log("warn", "rejected invalid relay message", {
			id: user?.id,
			type: user?.type,
		});
		sendError(socket, "invalid_message", "message must be valid JSON with the relay schema");
		return;
	}

	forwardMessage(socket, message);
}

export function runRelayServer(options?: { port?: number }) {
	const port = options?.port ?? parsePort(process.env.PORT);
	const wss = new WebSocketServer({
		noServer: true,
		handleProtocols(protocols) {
			if (protocols.has(RELAY_BROWSER_PROTOCOL)) {
				return RELAY_BROWSER_PROTOCOL;
			}

			const firstProtocol = protocols.values().next();
			return firstProtocol.done ? false : firstProtocol.value;
		},
	});
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;

		if (pathname === "/health") {
			sendJson(response, 200, {
				ok: true,
				service: "relay-server",
			});
			return;
		}

		if (pathname === RELAY_BOOTSTRAP_PATH) {
			const corsHeaders = createCorsHeaders();

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

			const bootstrapRequest = await parseRelayBootstrapRequest(request);
			if (!bootstrapRequest) {
				sendJson(response, 400, { message: "Invalid relay bootstrap request." }, corsHeaders);
				return;
			}

			const defaultAgentId = getDefaultAgentId();
			if (!defaultAgentId) {
				sendJson(
					response,
					500,
					{ message: "RELAY_DEFAULT_AGENT_ID or PI_RELAY_AGENT_ID is required." },
					corsHeaders,
				);
				return;
			}

			try {
				const payload = {
					clientId: bootstrapRequest.clientId,
					agentId: defaultAgentId,
					token: generateToken({ type: "client", id: bootstrapRequest.clientId }),
					expiresAt: Date.now() + RELAY_JWT_TTL_MS,
					websocketUrl: resolvePublicWebSocketUrl(request),
				} satisfies RelayClientBootstrapResponse;
				sendJson(response, 200, payload, corsHeaders);
			} catch (error) {
				log("error", "failed to issue relay bootstrap token", {
					clientId: bootstrapRequest.clientId,
					error: error instanceof Error ? error.message : String(error),
				});
				sendJson(
					response,
					500,
					{ message: error instanceof Error ? error.message : "failed to issue relay bootstrap token" },
					corsHeaders,
				);
			}
			return;
		}

		sendText(response, 426, "Upgrade Required");
	});

	wss.on("connection", (socket: RelaySocket, request) => {
		try {
			socket.user = authenticateRequest(request);
		} catch (error) {
			const reason = error instanceof AuthError ? error.message : "unknown auth error";
			log("warn", "relay authentication failed", {
				reason,
				remoteAddress: request.socket.remoteAddress,
			});
			closeUnauthorized(socket);
			return;
		}

		registerConnection(socket);

		socket.on("message", (rawMessage) => {
			handleMessage(socket, rawMessage);
		});

		socket.on("error", (error) => {
			log("warn", "relay socket error", {
				id: socket.user?.id,
				type: socket.user?.type,
				error: error.message,
			});
		});

		socket.on("close", () => {
			cleanupConnection(socket);
		});
	});

	server.on("upgrade", (request, socket, head) => {
		wss.handleUpgrade(request, socket, head, (websocket) => {
			wss.emit("connection", websocket, request);
		});
	});

	server.listen(port);

	log("info", "relay server listening", {
		port,
		allowedActions: RELAY_ALLOWED_ACTIONS,
		defaultAgentId: getDefaultAgentId(),
		sqlitePath: process.env.RELAY_SQLITE_PATH?.trim() || ".data/relay-state.sqlite",
	});

	return wss;
}

if (import.meta.main) {
	runRelayServer();
}
