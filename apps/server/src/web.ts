
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	type RelayAgentCommand,
} from "@apreal/shared";
import { getConfiguredToolsLabel } from "./agent-tools.ts";
import {
	parseClientAppMessage,
	type ClientAppMessage,
	type ServerAppMessage,
} from "./protocol.ts";
import {
	createAgentController,
	formatModelLabel,
	getErrorMessage,
	prewarmAgentRuntime,
	type AgentController,
	type AgentStreamEvent,
} from "./session.ts";
import {
	ensureRelayAgentAuth,
	getRelayServerUrl,
	readClientTokenFromRequest,
	reauthenticateRelayAgent,
	verifyRelayClientAccess,
} from "./relay-auth.ts";
import { createLogger, summarizePrompt } from "./logger.ts";

const DEFAULT_PORT = 3000;
const SERVER_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = join(SERVER_SRC_DIR, "..", "..", "..");
const RELAY_STREAM_RETRY_MS = 1_000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_ENCODER = new TextEncoder();

type ClientTransport = "http" | "relay";

type ServerMessage = ServerAppMessage<SessionSummary, TranscriptMessage>;

type ClientConnection = {
	clientId: string;
	closed: boolean;
	ready: boolean;
	transport: ClientTransport;
	send(payload: ServerMessage): boolean | void;
};

type TranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "error";
	body: string;
	thinking: string;
	toolCalls: TranscriptToolCall[];
	segments: TranscriptMessageSegment[];
	pending: boolean;
	createdAt: number;
};

type TranscriptToolCall = {
	id: string;
	name: string;
	summary: string;
	status: "running" | "completed" | "failed";
	createdAt: number;
	updatedAt: number;
};

type TranscriptThinkingSegment = {
	id: string;
	type: "thinking";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

type TranscriptTextSegment = {
	id: string;
	type: "text";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

type TranscriptToolCallSegment = TranscriptToolCall & {
	type: "tool_call";
	contentIndex?: number;
};

type TranscriptMessageSegment = TranscriptTextSegment | TranscriptThinkingSegment | TranscriptToolCallSegment;

type SharedSessionState = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	abortRequested: boolean;
	model: string | null;
	controller: AgentController | null;
	controllerPromise: Promise<AgentController> | null;
	unsubscribe: (() => void) | null;
	transcript: TranscriptMessage[];
	pendingAssistantMessageId: string | null;
	toolCallMessageIds: Map<string, string>;
};

type SessionSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
};

function parseRelayAgentCommand(rawMessage: string): RelayAgentCommand | null {
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

function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

function mergeResponseHeaders(headers?: ResponseInit["headers"]): Record<string, string> {
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
		if (typeof value === "string") {
			mergedHeaders[key] = value;
			continue;
		}

		if (Array.isArray(value)) {
			mergedHeaders[key] = value.join(", ");
		}
	}

	return mergedHeaders;
}

function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		...init,
		headers: mergeResponseHeaders(init?.headers),
	});
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createCorsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
	};
}

function createSessionTitle(prompt: string): string {
	return summarizePrompt(prompt, 42) || "New chat";
}

function createSessionPreview(transcript: TranscriptMessage[]): string {
	for (let index = transcript.length - 1; index >= 0; index -= 1) {
		const entry = transcript[index];
		if (!entry) {
			continue;
		}

		const body = entry.body.trim();
		if (!body) {
			continue;
		}

		return summarizePrompt(body, 72);
	}

	return "No messages yet";
}

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
		segments: entry.segments.map((segment) => ({ ...segment })),
	}));
}

export async function runWebServer(options?: { cwd?: string; port?: number }) {
	const cwd = options?.cwd ?? process.env.PI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
	const port = options?.port ?? parsePort(process.env.PORT);
	const logger = createLogger("web-server");
	const relayUrl = getRelayServerUrl();
	let relayAgentAuth: Awaited<ReturnType<typeof ensureRelayAgentAuth>> | null = null;
	let relayStartupError: string | null = null;
	let relayTransportConnected = false;
	let relayTransportGeneration = 0;
	let relayTransportAbortController: AbortController | null = null;

	try {
		relayAgentAuth = await ensureRelayAgentAuth(logger, relayUrl);
	} catch (error) {
		relayStartupError = getErrorMessage(error);
		logger.warn("relay registration unavailable during startup", {
			relayUrl,
			error: relayStartupError,
		});
	}

	function getClientAuthErrorStatus(error: unknown): number {
		const message = getErrorMessage(error);
		return message === relayStartupError ? 503 : 401;
	}

	async function authenticateClientRequest(request: Request): Promise<{ clientId: string }> {
		if (!relayAgentAuth) {
			throw new Error(relayStartupError ?? "Relay registration is not ready.");
		}

		const clientToken = readClientTokenFromRequest(request);
		if (!clientToken) {
			throw new Error("Missing client auth token.");
		}

		return verifyRelayClientAccess(relayUrl, clientToken, relayAgentAuth.agentId);
	}

	const clients = new Map<string, ClientConnection>();
	const sessions = new Map<string, SharedSessionState>();
	let reauthPending = false;
	let reauthRunning = false;

	function resetClientConnections(reason: string) {
		for (const clientId of Array.from(clients.keys())) {
			removeClientConnection(clientId, reason);
		}
	}

	function resetRelayClientConnections(reason: string) {
		for (const [clientId, client] of Array.from(clients.entries())) {
			if (client.transport === "relay") {
				removeClientConnection(clientId, reason);
			}
		}
	}

	function setRelayTransportDisconnected(reason: string) {
		relayTransportConnected = false;
		resetRelayClientConnections(reason);
	}

	async function postRelayServerMessage(clientId: string, payload: ServerMessage) {
		if (!relayAgentAuth?.token) {
			throw new Error("Relay agent transport is not authenticated.");
		}

		const response = await fetch(new URL(RELAY_AGENT_MESSAGE_PATH, relayUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${relayAgentAuth.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				type: "server_message",
				clientId,
				message: payload,
			}),
		});

		if (response.ok) {
			return;
		}

		let message = `relay agent message failed with status ${response.status}`;
		try {
			const body: unknown = await response.json();
			if (isObjectRecord(body) && typeof body.message === "string") {
				message = body.message;
			}
		} catch {
			// Ignore malformed bodies and use the status fallback above.
		}

		throw new Error(message);
	}

	function createRelaySendPayload(clientId: string): ClientConnection["send"] {
		return (payload) => {
			void postRelayServerMessage(clientId, payload).catch((error) => {
				logger.warn("failed to deliver relay client payload", {
					clientId,
					error: getErrorMessage(error),
				});
				removeClientConnection(clientId, "relay_delivery_failed");
			});
			return true;
		};
	}

	function ensureRelayClientConnection(clientId: string) {
		const existing = clients.get(clientId);
		const wasReady = existing?.ready ?? false;
		const client = registerClientConnection(clientId, "relay", createRelaySendPayload(clientId));
		client.ready = true;
		if (!wasReady) {
			sendConnected(clientId);
			sendSessionsUpdated(clientId);
		}
		return client;
	}

	async function handleRelayAgentCommand(command: RelayAgentCommand) {
		switch (command.type) {
			case "client_connect": {
				ensureRelayClientConnection(command.clientId);
				break;
			}
			case "client_disconnect": {
				removeClientConnection(command.clientId, command.reason ?? "relay_client_disconnected");
				break;
			}
			case "client_message": {
				ensureRelayClientConnection(command.clientId);
				const message = parseClientAppMessage(command.message);
				if (!message) {
					sendError(command.clientId, "Invalid client message payload.");
					return;
				}

				await handleClientMessage(command.clientId, message);
				break;
			}
		}
	}

	async function consumeRelayAgentStream(token: string, signal: AbortSignal) {
		const response = await fetch(new URL(RELAY_AGENT_STREAM_PATH, relayUrl), {
			method: "GET",
			headers: {
				authorization: `Bearer ${token}`,
				accept: "text/event-stream",
			},
			signal,
		});

		if (!response.ok || !response.body) {
			let message = `relay agent stream failed with status ${response.status}`;
			try {
				const body = await response.text();
				if (body.trim()) {
					message = body.trim();
				}
			} catch {
				// Ignore malformed bodies and use the status fallback above.
			}

			throw new Error(message);
		}

		relayTransportConnected = true;
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const result = await reader.read();
				if (result.done) {
					break;
				}

				buffer += decoder.decode(result.value, { stream: true });
				let boundaryIndex = buffer.search(/\r?\n\r?\n/);
				while (boundaryIndex !== -1) {
					const rawEvent = buffer.slice(0, boundaryIndex);
					const separatorLength = buffer[boundaryIndex] === "\r" ? 4 : 2;
					buffer = buffer.slice(boundaryIndex + separatorLength);

					const data = rawEvent
						.split(/\r?\n/)
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");

					if (data) {
						const command = parseRelayAgentCommand(data);
						if (command) {
							await handleRelayAgentCommand(command);
						} else {
							logger.warn("ignored invalid relay agent command", { raw: data });
						}
					}

					boundaryIndex = buffer.search(/\r?\n\r?\n/);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async function runRelayTransportLoop(generation: number) {
		while (generation === relayTransportGeneration) {
			const currentAuth = relayAgentAuth;
			if (!currentAuth?.token) {
				setRelayTransportDisconnected("relay_transport_unavailable");
				return;
			}

			const abortController = new AbortController();
			relayTransportAbortController = abortController;

			try {
				await consumeRelayAgentStream(currentAuth.token, abortController.signal);
				if (abortController.signal.aborted || generation !== relayTransportGeneration) {
					return;
				}

				logger.warn("relay agent stream ended; reconnecting", {
					relayUrl,
					agentId: currentAuth.agentId,
				});
			} catch (error) {
				if (abortController.signal.aborted || generation !== relayTransportGeneration) {
					return;
				}

				logger.warn("relay agent stream disconnected", {
					relayUrl,
					agentId: currentAuth.agentId,
					error: getErrorMessage(error),
				});
			} finally {
				if (relayTransportAbortController === abortController) {
					relayTransportAbortController = null;
				}
				setRelayTransportDisconnected("relay_transport_disconnected");
			}

			if (generation !== relayTransportGeneration) {
				return;
			}

			await delay(RELAY_STREAM_RETRY_MS);
		}
	}

	function restartRelayTransport() {
		relayTransportGeneration += 1;
		relayTransportAbortController?.abort();
		setRelayTransportDisconnected("relay_transport_restarting");

		if (!relayAgentAuth?.token) {
			return;
		}

		void runRelayTransportLoop(relayTransportGeneration);
	}

	async function handleReauthenticationInput(rawValue: string) {
		if (reauthRunning) {
			logger.warn("relay reauthentication already in progress");
			return;
		}

		reauthRunning = true;
		try {
			relayAgentAuth = await reauthenticateRelayAgent(logger, rawValue, relayUrl);
			relayStartupError = null;
			resetClientConnections("relay_reauthenticated");
			restartRelayTransport();
			logger.info("relay reauthentication completed", {
				agentId: relayAgentAuth.agentId,
				targetId: relayAgentAuth.targetId,
			});
			console.log("Relay reauthentication completed.");
		} catch (error) {
			const message = getErrorMessage(error);
			logger.warn("relay reauthentication failed", { error: message });
			console.error(`Relay reauthentication failed: ${message}`);
		} finally {
			reauthPending = false;
			reauthRunning = false;
		}
	}

	const commandInput = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	commandInput.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		if (reauthPending) {
			void handleReauthenticationInput(trimmed);
			return;
		}

		const directReauthMatch = /^reauthenticate\s+(.+)$/i.exec(trimmed);
		if (directReauthMatch?.[1]) {
			void handleReauthenticationInput(directReauthMatch[1]);
			return;
		}

		if (/^reauthenticate$/i.test(trimmed)) {
			reauthPending = true;
			console.log("Enter the browser authentication code:");
		}
	});

	if (relayAgentAuth?.token) {
		restartRelayTransport();
	}

	function createSseChunk(payload: ServerMessage): Uint8Array {
		return SSE_ENCODER.encode(`data: ${JSON.stringify(payload)}\n\n`);
	}

	function createSseComment(comment: string): Uint8Array {
		return SSE_ENCODER.encode(`: ${comment}\n\n`);
	}

	function createSseStreamResponse(request: Request, clientId: string): Response {
		const stream = new TransformStream<Uint8Array, Uint8Array>();
		const writer = stream.writable.getWriter();
		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const closeStream = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existingClient = clients.get(clientId);
			if (existingClient?.send === sendPayload) {
				removeClientConnection(clientId, reason);
			}

			void writer.close().catch(() => {
				// Ignore stream close races from disconnects.
			});
		};

		const sendPayload: ClientConnection["send"] = (payload) => {
			if (closed) {
				return false;
			}

			void writer.write(createSseChunk(payload)).catch((error) => {
				logger.warn("failed to write http stream payload", {
					clientId,
					error: getErrorMessage(error),
				});
				closeStream("http_stream_write_failed");
			});
			return true;
		};

		void writer.write(createSseComment("connected")).catch(() => {
			closeStream("http_stream_open_failed");
		});

		const client = registerClientConnection(clientId, "http", sendPayload);
		client.ready = true;
		sendConnected(clientId);
		sendSessionsUpdated(clientId);

		heartbeatTimer = setInterval(() => {
			if (closed) {
				return;
			}

			void writer.write(createSseComment("ping")).catch(() => {
				closeStream("http_stream_heartbeat_failed");
			});
		}, SSE_HEARTBEAT_INTERVAL_MS);

		request.signal.addEventListener("abort", () => {
			closeStream("http_stream_closed");
		});

		return new Response(stream.readable, {
			headers: {
				...createCorsHeaders(),
				"cache-control": "no-store",
				connection: "keep-alive",
				"content-type": "text/event-stream; charset=utf-8",
				"x-accel-buffering": "no",
			},
		});
	}

	async function handleHttpClientMessage(request: Request, clientId: string): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}

		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}

		const client = clients.get(clientId);
		if (!client || client.closed) {
			return json(
				{ message: "Client event stream is not connected." },
				{ status: 409, headers: createCorsHeaders() },
			);
		}

		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Invalid client message payload." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}

		const message = parseClientAppMessage(payload);
		if (!message) {
			return json(
				{ message: "Invalid client message payload." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}

		await handleClientMessage(clientId, message);
		return json({ ok: true }, { status: 202, headers: createCorsHeaders() });
	}

	function sendClientPayload(
		clientId: string,
		payload: ServerMessage,
		options?: { requireReady?: boolean },
	): boolean {
		const client = clients.get(clientId);
		if (!client || client.closed) {
			return false;
		}

		if ((options?.requireReady ?? true) && !client.ready) {
			return false;
		}

		try {
			return client.send(payload) !== false;
		} catch (error) {
			logger.warn("failed to send client payload", {
				clientId,
				transport: client.transport,
				error: getErrorMessage(error),
			});
			return false;
		}
	}

	function registerClientConnection(
		clientId: string,
		transport: ClientTransport,
		sendPayload: ClientConnection["send"],
	) {
		const existing = clients.get(clientId);
		if (existing) {
			existing.closed = false;
			existing.transport = transport;
			existing.send = sendPayload;
			return existing;
		}

		const connection: ClientConnection = {
			clientId,
			closed: false,
			ready: false,
			transport,
			send: sendPayload,
		};
		clients.set(clientId, connection);
		logger.info("client transport connected", {
			clientId,
			transport,
			clients: clients.size,
		});
		return connection;
	}

	function removeClientConnection(clientId: string, reason: string) {
		const client = clients.get(clientId);
		if (!client) {
			return;
		}

		client.closed = true;
		clients.delete(clientId);
		logger.info("client transport disconnected", {
			clientId,
			transport: client.transport,
			reason,
			clients: clients.size,
		});
	}

	function sendError(clientId: string, message: string, sessionId?: string) {
		sendClientPayload(clientId, { type: "error", message, sessionId }, { requireReady: false });
	}

	function buildSessionSummary(session: SharedSessionState): SessionSummary {
		return {
			id: session.id,
			title: session.title,
			preview: createSessionPreview(session.transcript),
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			busy: session.busy,
			model: session.model,
			messageCount: session.transcript.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
		};
	}

	function listSessions(): SessionSummary[] {
		return Array.from(sessions.values())
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map(buildSessionSummary);
	}

	function broadcast(payload: ServerMessage) {
		for (const client of clients.values()) {
			if (client.closed || !client.ready) {
				continue;
			}

			sendClientPayload(client.clientId, payload);
		}
	}

	function sendSessionsUpdated(targetClientId?: string) {
		const payload = {
			type: "sessions_updated",
			sessions: listSessions(),
		} satisfies ServerMessage;

		if (targetClientId) {
			sendClientPayload(targetClientId, payload, { requireReady: false });
			return;
		}

		broadcast(payload);
	}

	function buildSessionPayload(session: SharedSessionState) {
		return {
			session: buildSessionSummary(session),
			transcript: cloneTranscript(session.transcript),
		};
	}

	function sendSessionSnapshot(targetClientId: string, session: SharedSessionState) {
		sendClientPayload(targetClientId, {
			type: "session_snapshot",
			...buildSessionPayload(session),
		});
	}

	function broadcastSessionSnapshot(session: SharedSessionState) {
		broadcast({
			type: "session_snapshot",
			...buildSessionPayload(session),
		});
	}

	function touchSession(session: SharedSessionState) {
		session.updatedAt = Date.now();
	}

	function appendTranscriptMessage(
		session: SharedSessionState,
		message: Omit<TranscriptMessage, "createdAt">,
	) {
		session.transcript.push({
			...message,
			thinking: message.thinking ?? "",
			toolCalls: message.toolCalls ? message.toolCalls.map((toolCall) => ({ ...toolCall })) : [],
			segments: message.segments ? message.segments.map((segment) => ({ ...segment })) : [],
			createdAt: Date.now(),
		});
		touchSession(session);
	}

	function createPendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
		const message: TranscriptMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			body: "",
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: true,
			createdAt: Date.now(),
		};
		session.pendingAssistantMessageId = message.id;
		session.transcript.push(message);
		touchSession(session);
		return message;
	}

	function getPendingAssistantMessage(session: SharedSessionState): TranscriptMessage | null {
		if (!session.pendingAssistantMessageId) {
			return null;
		}

		const message = session.transcript.find((entry) => entry.id === session.pendingAssistantMessageId);
		if (!message) {
			session.pendingAssistantMessageId = null;
			return null;
		}

		return message;
	}

	function finalizeAssistantMessage(session: SharedSessionState) {
		const message = getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		message.pending = false;
		if (!message.body.trim() && !message.thinking.trim() && message.toolCalls.length === 0) {
			session.transcript = session.transcript.filter((entry) => entry.id !== message.id);
		}

		session.pendingAssistantMessageId = null;
		touchSession(session);
	}

	function settleSession(session: SharedSessionState) {
		finalizeAssistantMessage(session);
		session.busy = false;
		session.abortRequested = false;
		touchSession(session);
	}

	function createSharedSession(initialPrompt: string): SharedSessionState {
		const now = Date.now();
		return {
			id: crypto.randomUUID(),
			title: createSessionTitle(initialPrompt),
			createdAt: now,
			updatedAt: now,
			busy: false,
			abortRequested: false,
			model: null,
			controller: null,
			controllerPromise: null,
			unsubscribe: null,
			transcript: [],
			pendingAssistantMessageId: null,
			toolCallMessageIds: new Map(),
		};
	}

	function ensurePendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
		return getPendingAssistantMessage(session) ?? createPendingAssistantMessage(session);
	}

	function findTranscriptMessage(session: SharedSessionState, messageId: string): TranscriptMessage | null {
		return session.transcript.find((entry) => entry.id === messageId) ?? null;
	}

	function getSegmentSortValue(segment: TranscriptMessageSegment): number {
		return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
	}

	function insertAssistantSegment(message: TranscriptMessage, segment: TranscriptMessageSegment) {
		const insertIndex = message.segments.findIndex(
			(existing) => getSegmentSortValue(existing) > getSegmentSortValue(segment),
		);
		if (insertIndex === -1) {
			message.segments.push(segment);
			return;
		}

		message.segments.splice(insertIndex, 0, segment);
	}

	function appendAssistantText(
		session: SharedSessionState,
		delta: string,
		contentIndex?: number,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.body += delta;
		const existingSegment = message.segments.find(
			(entry): entry is TranscriptTextSegment =>
				entry.type === "text" &&
				(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
		);
		if (existingSegment) {
			existingSegment.content += delta;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				id: crypto.randomUUID(),
				type: "text",
				content: delta,
				contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}
		touchSession(session);
		return message;
	}

	function appendAssistantThinking(
		session: SharedSessionState,
		delta: string,
		contentIndex?: number,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.thinking += delta;
		const existingSegment = message.segments.find(
			(entry): entry is TranscriptThinkingSegment =>
				entry.type === "thinking" &&
				(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
		);
		if (existingSegment) {
			existingSegment.content += delta;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				id: crypto.randomUUID(),
				type: "thinking",
				content: delta,
				contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}
		touchSession(session);
		return message;
	}

	function upsertAssistantToolCall(
		session: SharedSessionState,
		toolCall: Omit<TranscriptToolCall, "createdAt" | "updatedAt"> & { contentIndex?: number },
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		const existing = message.toolCalls.find((entry) => entry.id === toolCall.id);
		if (existing) {
			existing.name = toolCall.name;
			existing.summary = toolCall.summary;
			existing.status = toolCall.status;
			existing.updatedAt = now;
		} else {
			message.toolCalls.push({
				...toolCall,
				createdAt: now,
				updatedAt: now,
			});
		}

		const existingSegment = message.segments.find(
			(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCall.id,
		);
		if (existingSegment) {
			existingSegment.name = toolCall.name;
			existingSegment.summary = toolCall.summary;
			existingSegment.status = toolCall.status;
			existingSegment.contentIndex = toolCall.contentIndex ?? existingSegment.contentIndex;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				...toolCall,
				type: "tool_call",
				contentIndex: toolCall.contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}

		session.toolCallMessageIds.set(toolCall.id, message.id);
		touchSession(session);
		return message;
	}

	function updateAssistantToolCallStatus(
		session: SharedSessionState,
		toolCallId: string,
		status: TranscriptToolCall["status"],
	) {
		const ownerMessageId = session.toolCallMessageIds.get(toolCallId);
		const message = ownerMessageId ? findTranscriptMessage(session, ownerMessageId) : getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		const toolCall = message.toolCalls.find((entry) => entry.id === toolCallId);
		if (!toolCall) {
			return;
		}

		toolCall.status = status;
		toolCall.updatedAt = Date.now();
		const toolSegment = message.segments.find(
			(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCallId,
		);
		if (toolSegment) {
			toolSegment.status = status;
			toolSegment.updatedAt = toolCall.updatedAt;
		}
		touchSession(session);
	}

	function failRunningAssistantToolCalls(session: SharedSessionState) {
		let changed = false;
		for (const message of session.transcript) {
			for (const toolCall of message.toolCalls) {
				if (toolCall.status === "running") {
					toolCall.status = "failed";
					toolCall.updatedAt = Date.now();
					changed = true;
				}
			}

			for (const segment of message.segments) {
				if (segment.type === "tool_call" && segment.status === "running") {
					segment.status = "failed";
					segment.updatedAt = Date.now();
					changed = true;
				}
			}
		}

		if (changed) {
			touchSession(session);
		}
	}

	function applyAssistantMessageSnapshot(
		session: SharedSessionState,
		snapshot: Extract<AgentStreamEvent, { type: "message_end" }>,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.body =
			snapshot.stopReason === "error" && snapshot.errorMessage && !snapshot.body.trim()
				? `Error: ${snapshot.errorMessage}`
				: snapshot.body;
		message.thinking = snapshot.thinking;
		const existingToolCalls = new Map(message.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
		message.toolCalls = snapshot.toolCalls.map((toolCall) => {
			const existingToolCall = existingToolCalls.get(toolCall.id);
			return {
				id: toolCall.id,
				name: toolCall.name,
				summary: toolCall.summary,
				status: toolCall.status,
				createdAt: existingToolCall?.createdAt ?? now,
				updatedAt: now,
			};
		});

		if (snapshot.segments.length > 0) {
			const existingTextSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptTextSegment => segment.type === "text")
					.map((segment) => [segment.contentIndex ?? -1, segment]),
			);
			const existingThinkingSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptThinkingSegment => segment.type === "thinking")
					.map((segment) => [segment.contentIndex ?? -1, segment]),
			);
			const existingToolSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptToolCallSegment => segment.type === "tool_call")
					.map((segment) => [segment.id, segment]),
			);

			message.segments = snapshot.segments.map((segment) => {
				switch (segment.type) {
					case "text": {
						const existingSegment = existingTextSegments.get(segment.contentIndex);
						return {
							id: existingSegment?.id ?? crypto.randomUUID(),
							type: "text",
							content: segment.content,
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
					case "thinking": {
						const existingSegment = existingThinkingSegments.get(segment.contentIndex);
						return {
							id: existingSegment?.id ?? crypto.randomUUID(),
							type: "thinking",
							content: segment.content,
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
					case "tool_call": {
						const existingSegment = existingToolSegments.get(segment.id);
						return {
							id: segment.id,
							name: segment.name,
							summary: segment.summary,
							status: segment.status,
							type: "tool_call",
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
				}
			});
		}

		for (const toolCall of message.toolCalls) {
			if (message.segments.some((segment) => segment.type === "tool_call" && segment.id === toolCall.id)) {
				continue;
			}

			insertAssistantSegment(message, {
				...toolCall,
				type: "tool_call",
				createdAt: toolCall.createdAt,
				updatedAt: toolCall.updatedAt,
			});
		}

		touchSession(session);
		return message;
	}

	function handleControllerEvent(session: SharedSessionState, event: AgentStreamEvent) {
		switch (event.type) {
			case "assistant_message_start": {
				if (!getPendingAssistantMessage(session)) {
					createPendingAssistantMessage(session);
					broadcastSessionSnapshot(session);
				}
				break;
			}
			case "message_end": {
				applyAssistantMessageSnapshot(session, event);
				finalizeAssistantMessage(session);
				broadcastSessionSnapshot(session);
				break;
			}
			case "text_delta": {
				const message = appendAssistantText(session, event.delta, event.contentIndex);
				broadcast({
					type: "assistant_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
					contentIndex: event.contentIndex,
				});
				break;
			}
			case "thinking_delta": {
				const message = appendAssistantThinking(session, event.delta, event.contentIndex);
				broadcast({
					type: "assistant_thinking_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
					contentIndex: event.contentIndex,
				});
				break;
			}
			case "tool_call": {
				upsertAssistantToolCall(session, {
					id: event.tool.id,
					name: event.tool.name,
					summary: event.tool.summary,
					status: event.tool.status,
					contentIndex: event.contentIndex,
				});
				broadcastSessionSnapshot(session);
				break;
			}
			case "tool_execution_start": {
				updateAssistantToolCallStatus(session, event.tool.id, event.tool.status);
				broadcastSessionSnapshot(session);
				break;
			}
			case "tool_execution_end": {
				updateAssistantToolCallStatus(session, event.toolId, event.status);
				broadcastSessionSnapshot(session);
				break;
			}
			case "done": {
				settleSession(session);
				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
				break;
			}
			case "error": {
				const aborted = session.abortRequested;
				failRunningAssistantToolCalls(session);
				settleSession(session);
				if (!aborted) {
					appendTranscriptMessage(session, {
						id: crypto.randomUUID(),
						role: "error",
						body: `Error: ${event.message}`,
						thinking: "",
						toolCalls: [],
						segments: [],
						pending: false,
					});
				}

				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
				break;
			}
		}
	}

	async function ensureController(session: SharedSessionState) {
		const sessionLogger = createLogger(`web-session:${session.id}`);
		if (session.controller) {
			return session.controller;
		}

		if (session.controllerPromise) {
			return session.controllerPromise;
		}

		session.controllerPromise = (async () => {
			sessionLogger.info("creating shared browser session", { cwd, sessionId: session.id });
			const controller = await createAgentController(cwd, {
				sessionId: session.id,
				transport: "http",
			});
			session.controller = controller;
			session.model = formatModelLabel(controller.model);
			session.unsubscribe = controller.subscribe((event) => {
				handleControllerEvent(session, event);
			});
			touchSession(session);
			sendSessionsUpdated();
			return controller;
		})();

		try {
			return await session.controllerPromise;
		} finally {
			session.controllerPromise = null;
		}
	}

	async function handlePrompt(
		clientId: string,
		prompt: string,
		sessionId?: string | null,
	) {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			sendError(clientId, "Prompt cannot be empty.");
			return;
		}

		let session = sessionId ? sessions.get(sessionId) : null;
		const createdSession = !session;
		if (sessionId && !session) {
			sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session) {
			session = createSharedSession(trimmedPrompt);
			sessions.set(session.id, session);
		}

		if (session.busy) {
			sendError(
				clientId,
				"The selected session is still responding. Wait for it to finish or abort the current run.",
				session.id,
			);
			return;
		}

		session.abortRequested = false;
		session.busy = true;
		appendTranscriptMessage(session, {
			id: crypto.randomUUID(),
			role: "user",
			body: trimmedPrompt,
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: false,
		});
		createPendingAssistantMessage(session);

		if (createdSession) {
			sendClientPayload(clientId, {
				type: "session_created",
				...buildSessionPayload(session),
			}, { requireReady: false });
		} else {
			broadcastSessionSnapshot(session);
		}
		sendSessionsUpdated();

		try {
			const controller = await ensureController(session);
			if (controller.isStreaming()) {
				throw new Error(
					"The selected session is still responding. Wait for it to finish or abort the current run.",
				);
			}

			await controller.prompt(trimmedPrompt);
			if (session.busy && !controller.isStreaming()) {
				settleSession(session);
				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
			}
		} catch (error) {
			logger.error("browser prompt failed", {
				sessionId: session.id,
				error: getErrorMessage(error),
			});
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "error",
				body: `Error: ${getErrorMessage(error)}`,
				thinking: "",
				toolCalls: [],
				segments: [],
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
			sendError(clientId, getErrorMessage(error), session.id);
		}
	}

	async function handleAbort(clientId: string, sessionId: string) {
		const session = sessions.get(sessionId);
		if (!session) {
			sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session.busy) {
			sendSessionSnapshot(clientId, session);
			return;
		}

		session.abortRequested = true;
		try {
			if (session.controller) {
				await session.controller.abort();
			} else if (session.controllerPromise) {
				const controller = await session.controllerPromise;
				await controller.abort();
			}
		} catch (error) {
			logger.error("abort failed", {
				sessionId,
				error: getErrorMessage(error),
			});
			sendError(clientId, getErrorMessage(error), sessionId);
		} finally {
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "system",
				body: "Response aborted.",
				thinking: "",
				toolCalls: [],
				segments: [],
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
		}
	}

	function sendConnected(clientId: string) {
		sendClientPayload(
			clientId,
			{
				type: "connected",
				clientId,
				message: "Connected. Browser chats are shared across tabs while the server is running.",
				tools: getConfiguredToolsLabel(),
			},
			{ requireReady: false },
		);
	}

	async function handleClientMessage(clientId: string, message: ClientAppMessage) {
		const client = clients.get(clientId);
		if (!client || client.closed) {
			logger.warn("message received for missing client", { clientId, type: message.type });
			return;
		}

		if (!client.ready) {
			sendError(clientId, "Client must send hello before other messages.");
			return;
		}

		switch (message.type) {
			case "prompt": {
				await handlePrompt(clientId, message.prompt, message.sessionId);
				break;
			}
			case "abort": {
				await handleAbort(clientId, message.sessionId);
				break;
			}
			case "load_session": {
				const session = sessions.get(message.sessionId);
				if (!session) {
					sendError(clientId, "The selected session could not be found.", message.sessionId);
					return;
				}

				sendSessionSnapshot(clientId, session);
				break;
			}
			case "ping": {
				sendClientPayload(clientId, { type: "pong" }, { requireReady: false });
				break;
			}
		}
	}

	void prewarmAgentRuntime().catch((error) => {
		logger.warn("agent runtime prewarm failed", {
			error: getErrorMessage(error),
		});
	});

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = Bun.serve({
			port,
			async fetch(request) {
				const url = new URL(request.url);
				logger.debug("incoming request", {
					method: request.method,
					path: url.pathname,
				});
				if (url.pathname === CLIENT_EVENT_STREAM_PATH) {
					if (request.method === "OPTIONS") {
						return new Response(null, {
							status: 204,
							headers: createCorsHeaders(),
						});
					}

					if (request.method !== "GET") {
						return new Response("Method Not Allowed", {
							status: 405,
							headers: createCorsHeaders(),
						});
					}

					try {
						const auth = await authenticateClientRequest(request);
						return createSseStreamResponse(request, auth.clientId);
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: getClientAuthErrorStatus(error), headers: createCorsHeaders() },
						);
					}
				}

				if (url.pathname === CLIENT_MESSAGE_PATH) {
					try {
						const auth = await authenticateClientRequest(request);
						return handleHttpClientMessage(request, auth.clientId);
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: getClientAuthErrorStatus(error), headers: createCorsHeaders() },
						);
					}
				}

				if (url.pathname === "/health") {
					return json({
						service: "web-server",
						status: "ok",
						transport: "http-sse+relay",
						clients: clients.size,
						sessions: sessions.size,
						relayReady: Boolean(relayAgentAuth),
						relayTransportConnected,
						agentId: relayAgentAuth?.agentId ?? null,
						relayUrl,
						relayStartupError,
						cwd,
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	} catch (error) {
		logger.error("failed to start web server", {
			port,
			error: getErrorMessage(error),
		});
		throw error;
	}

	logger.info("web server ready", {
		cwd,
		port: server.port,
		logLevel: process.env.LOG_LEVEL ?? "info",
		transport: "http-sse+relay",
		agentId: relayAgentAuth?.agentId ?? null,
		relayUrl,
		relayReady: Boolean(relayAgentAuth),
		relayTransportConnected,
	});
	console.log(`Pi web server ready in ${cwd}`);
	console.log("Frontend UI: http://localhost:5173");
	console.log(`Health check: http://localhost:${server.port}/health`);
	console.log(`Relay auth: ${relayUrl}`);
	console.log(`Agent id: ${relayAgentAuth?.agentId ?? "not registered"}`);
	if (relayStartupError) {
		console.log(`Relay registration status: ${relayStartupError}`);
	}
	console.log(`Relay transport: ${relayTransportConnected ? "connected" : "connecting"}`);
	console.log("Browser chat sessions are shared across tabs while the server is running.");
	console.log("Type 'reauthenticate' to pair this server with a newly generated browser code.");

	return server;
}

if (import.meta.main) {
	void runWebServer();
}
