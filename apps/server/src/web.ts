import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BUILT_IN_TOOLS_LABEL,
	createAgentController,
	formatModelLabel,
	getErrorMessage,
	prewarmAgentRuntime,
	type AgentController,
	type AgentStreamEvent,
} from "./session.ts";
import { createLogger, summarizePrompt } from "./logger.ts";

const DEFAULT_PORT = 3000;
const SERVER_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = join(SERVER_SRC_DIR, "..", "..", "..");

type WebSocketData = {
	clientId: string;
};

type ClientConnection = {
	clientId: string;
	closed: boolean;
	socket: Bun.ServerWebSocket<WebSocketData>;
};

type TranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "error";
	body: string;
	thinking: string;
	toolCalls: TranscriptToolCall[];
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

type ClientMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "ping" };

function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		headers: {
			"cache-control": "no-store",
		},
		...init,
	});
}

function send(ws: Bun.ServerWebSocket<WebSocketData>, payload: Record<string, unknown>) {
	ws.send(JSON.stringify(payload));
}

function sendError(
	ws: Bun.ServerWebSocket<WebSocketData>,
	message: string,
	sessionId?: string,
) {
	send(ws, { type: "error", message, sessionId });
}

function parseClientMessage(rawMessage: string | Buffer): ClientMessage | null {
	try {
		const value = JSON.parse(rawMessage.toString()) as Record<string, unknown>;
		if (value.type === "prompt" && typeof value.prompt === "string") {
			return {
				type: "prompt",
				prompt: value.prompt,
				sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
			};
		}

		if (value.type === "abort" && typeof value.sessionId === "string") {
			return { type: "abort", sessionId: value.sessionId };
		}

		if (value.type === "load_session" && typeof value.sessionId === "string") {
			return { type: "load_session", sessionId: value.sessionId };
		}

		if (value.type === "ping") {
			return { type: "ping" };
		}
	} catch {
		return null;
	}

	return null;
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
	}));
}

export function runWebServer(options?: { cwd?: string; port?: number }) {
	const cwd = options?.cwd ?? process.env.PI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
	const port = options?.port ?? parsePort(process.env.PORT);
	const clients = new Map<string, ClientConnection>();
	const sessions = new Map<string, SharedSessionState>();
	const logger = createLogger("web-server");

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

	function broadcast(payload: Record<string, unknown>) {
		for (const client of clients.values()) {
			if (client.closed) {
				continue;
			}

			try {
				send(client.socket, payload);
			} catch (error) {
				logger.warn("failed to broadcast websocket payload", {
					clientId: client.clientId,
					error: getErrorMessage(error),
				});
			}
		}
	}

	function sendSessionsUpdated(target?: Bun.ServerWebSocket<WebSocketData>) {
		const payload = {
			type: "sessions_updated",
			sessions: listSessions(),
		};

		if (target) {
			send(target, payload);
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

	function sendSessionSnapshot(target: Bun.ServerWebSocket<WebSocketData>, session: SharedSessionState) {
		send(target, {
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
		};
	}

	function ensurePendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
		return getPendingAssistantMessage(session) ?? createPendingAssistantMessage(session);
	}

	function appendAssistantThinking(session: SharedSessionState, delta: string): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		message.thinking += delta;
		touchSession(session);
		return message;
	}

	function upsertAssistantToolCall(
		session: SharedSessionState,
		toolCall: Omit<TranscriptToolCall, "createdAt" | "updatedAt">,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const existing = message.toolCalls.find((entry) => entry.id === toolCall.id);
		if (existing) {
			existing.name = toolCall.name;
			existing.summary = toolCall.summary;
			existing.status = toolCall.status;
			existing.updatedAt = Date.now();
		} else {
			message.toolCalls.push({
				...toolCall,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		}

		touchSession(session);
		return message;
	}

	function updateAssistantToolCallStatus(
		session: SharedSessionState,
		toolCallId: string,
		status: TranscriptToolCall["status"],
	) {
		const message = getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		const toolCall = message.toolCalls.find((entry) => entry.id === toolCallId);
		if (!toolCall) {
			return;
		}

		toolCall.status = status;
		toolCall.updatedAt = Date.now();
		touchSession(session);
	}

	function failRunningAssistantToolCalls(session: SharedSessionState) {
		const message = getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		let changed = false;
		for (const toolCall of message.toolCalls) {
			if (toolCall.status === "running") {
				toolCall.status = "failed";
				toolCall.updatedAt = Date.now();
				changed = true;
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
		message.body =
			snapshot.stopReason === "error" && snapshot.errorMessage && !snapshot.body.trim()
				? `Error: ${snapshot.errorMessage}`
				: snapshot.body;
		message.thinking = snapshot.thinking;

		if (snapshot.toolCalls.length > 0) {
			const existingToolCalls = new Map(message.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
			message.toolCalls = snapshot.toolCalls.map((toolCall) => ({
				id: toolCall.id,
				name: toolCall.name,
				summary: toolCall.summary,
				status: existingToolCalls.get(toolCall.id)?.status ?? toolCall.status,
				createdAt: existingToolCalls.get(toolCall.id)?.createdAt ?? Date.now(),
				updatedAt: Date.now(),
			}));
		}

		touchSession(session);
		return message;
	}

	function handleControllerEvent(session: SharedSessionState, event: AgentStreamEvent) {
		switch (event.type) {
			case "message_end": {
				applyAssistantMessageSnapshot(session, event);
				broadcastSessionSnapshot(session);
				break;
			}
			case "text_delta": {
				const message = ensurePendingAssistantMessage(session);
				message.body += event.delta;
				touchSession(session);
				broadcast({
					type: "assistant_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
				});
				break;
			}
			case "thinking_delta": {
				const message = appendAssistantThinking(session, event.delta);
				broadcast({
					type: "assistant_thinking_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
				});
				break;
			}
			case "tool_execution_start": {
				upsertAssistantToolCall(session, {
					id: event.tool.id,
					name: event.tool.name,
					summary: event.tool.summary,
					status: event.tool.status,
				});
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
				transport: "websocket",
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
		ws: Bun.ServerWebSocket<WebSocketData>,
		prompt: string,
		sessionId?: string | null,
	) {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			sendError(ws, "Prompt cannot be empty.");
			return;
		}

		let session = sessionId ? sessions.get(sessionId) : null;
		const createdSession = !session;
		if (sessionId && !session) {
			sendError(ws, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session) {
			session = createSharedSession(trimmedPrompt);
			sessions.set(session.id, session);
		}

		if (session.busy) {
			sendError(
				ws,
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
			pending: false,
		});
		createPendingAssistantMessage(session);

		if (createdSession) {
			send(ws, {
				type: "session_created",
				...buildSessionPayload(session),
			});
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
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
			sendError(ws, getErrorMessage(error), session.id);
		}
	}

	async function handleAbort(ws: Bun.ServerWebSocket<WebSocketData>, sessionId: string) {
		const session = sessions.get(sessionId);
		if (!session) {
			sendError(ws, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session.busy) {
			sendSessionSnapshot(ws, session);
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
			sendError(ws, getErrorMessage(error), sessionId);
		} finally {
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "system",
				body: "Response aborted.",
				thinking: "",
				toolCalls: [],
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
		}
	}

	void prewarmAgentRuntime().catch((error) => {
		logger.warn("agent runtime prewarm failed", {
			error: getErrorMessage(error),
		});
	});

	let server: Bun.Server<WebSocketData>;
	try {
		server = Bun.serve<WebSocketData>({
			port,
			fetch(request, serverInstance) {
				const url = new URL(request.url);
				logger.debug("incoming request", {
					method: request.method,
					path: url.pathname,
				});
				if (url.pathname === "/ws") {
					const clientId = crypto.randomUUID();
					if (
						serverInstance.upgrade(request, {
							data: { clientId },
						})
					) {
						logger.info("websocket upgrade accepted", { clientId });
						return;
					}

					logger.warn("websocket upgrade failed");
					return new Response("WebSocket upgrade failed.", { status: 400 });
				}

				if (url.pathname === "/health") {
					return json({
						status: "ok",
						transport: "websocket",
						clients: clients.size,
						sessions: sessions.size,
						cwd,
					});
				}

				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				idleTimeout: 120,
				open(ws) {
					clients.set(ws.data.clientId, {
						clientId: ws.data.clientId,
						closed: false,
						socket: ws,
					});

					logger.info("browser client connected", {
						clientId: ws.data.clientId,
						clients: clients.size,
					});
					send(ws, {
						type: "connected",
						clientId: ws.data.clientId,
						message: "Connected. Browser chats are shared across tabs while the server is running.",
						tools: BUILT_IN_TOOLS_LABEL,
					});
					sendSessionsUpdated(ws);
				},
				async message(ws, rawMessage) {
					const message = parseClientMessage(rawMessage);
					if (!message) {
						logger.warn("invalid websocket payload", {
							clientId: ws.data.clientId,
						});
						sendError(ws, "Invalid message payload.");
						return;
					}

					logger.debug("websocket message received", {
						clientId: ws.data.clientId,
						type: message.type,
					});

					switch (message.type) {
						case "prompt": {
							await handlePrompt(ws, message.prompt, message.sessionId);
							break;
						}
						case "abort": {
							await handleAbort(ws, message.sessionId);
							break;
						}
						case "load_session": {
							const session = sessions.get(message.sessionId);
							if (!session) {
								sendError(ws, "The selected session could not be found.", message.sessionId);
								return;
							}

							sendSessionSnapshot(ws, session);
							break;
						}
						case "ping": {
							send(ws, { type: "pong" });
							break;
						}
					}
				},
				close(ws) {
					const client = clients.get(ws.data.clientId);
					if (client) {
						client.closed = true;
					}
					clients.delete(ws.data.clientId);
					logger.info("browser client disconnected", {
						clientId: ws.data.clientId,
						clients: clients.size,
					});
				},
			},
		});
	} catch (error) {
		logger.error("failed to start web server", {
			port,
			error: getErrorMessage(error),
		});
		throw error;
	}

	logger.info("web server ready", { cwd, port: server.port, logLevel: process.env.LOG_LEVEL ?? "info" });
	console.log(`Pi web server ready in ${cwd}`);
	console.log("Frontend UI: http://localhost:5173");
	console.log(`Health check: http://localhost:${server.port}/health`);
	console.log(`WebSocket endpoint: ws://localhost:${server.port}/ws`);
	console.log("Browser chat sessions are shared across tabs while the server is running.");

	return server;
}

if (import.meta.main) {
	runWebServer();
}