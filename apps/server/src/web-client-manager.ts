import { getConfiguredToolsLabel } from "./agent-tools.ts";
import type { ClientAppMessage } from "./protocol.ts";
import { parseClientAppMessage } from "./protocol.ts";
import {
	buildSessionPayload,
	buildSessionSummary,
	type SessionSummary,
	type SharedSessionState,
} from "./web-session-state.ts";
import {
	createCorsHeaders,
	json,
	MAX_SESSION_PAGE_LIMIT,
	DEFAULT_SESSION_PAGE_LIMIT,
	SSE_ENCODER,
	SSE_HEARTBEAT_INTERVAL_MS,
	type ClientConnection,
	type ClientTransport,
	type ServerMessage,
} from "./web-utils.ts";
import type { createLogger } from "./logger.ts";

export type Logger = ReturnType<typeof createLogger>;

export interface ClientManagerState {
	logger: Logger;
	clients: Map<string, ClientConnection>;
	sessions: Map<string, SharedSessionState>;
}

export interface ClientActions {
	sendClientPayload(clientId: string, payload: ServerMessage, options?: { requireReady?: boolean }): boolean;
	sendError(clientId: string, message: string, sessionId?: string): void;
	sendConnected(clientId: string): void;
	broadcast(payload: ServerMessage): void;
	sendSessionPage(clientId: string, offset?: number, limit?: number): void;
	broadcastSessionSummaryUpdated(session: SharedSessionState): void;
	sendSessionSnapshot(targetClientId: string, session: SharedSessionState): void;
	broadcastSessionSnapshot(session: SharedSessionState): void;
	registerClientConnection(clientId: string, transport: ClientTransport, sendPayload: ClientConnection["send"]): ClientConnection;
	removeClientConnection(clientId: string, reason: string): void;
	normalizeSessionPageLimit(limit?: number): number;
	listSessions(): SessionSummary[];
	buildSessionPage(offset?: number, limit?: number): {
		sessions: SessionSummary[];
		offset: number;
		limit: number;
		total: number;
	};
	createSseStreamResponse(request: Request, clientId: string): Response;
	createHttpClientMessageHandler(handleClientMessage: (clientId: string, message: ClientAppMessage) => Promise<void>): (request: Request, clientId: string) => Promise<Response>;
}

function createSseChunk(payload: ServerMessage): Uint8Array {
	return SSE_ENCODER.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createSseComment(comment: string): Uint8Array {
	return SSE_ENCODER.encode(`: ${comment}\n\n`);
}

export function createClientManager(state: ClientManagerState): ClientActions {
	const { logger, clients, sessions } = state;

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

	function normalizeSessionPageLimit(limit?: number): number {
		if (!limit || !Number.isInteger(limit)) {
			return DEFAULT_SESSION_PAGE_LIMIT;
		}

		return Math.max(1, Math.min(MAX_SESSION_PAGE_LIMIT, limit));
	}

	function listSessions(): SessionSummary[] {
		return Array.from(sessions.values())
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map(buildSessionSummary);
	}

	function buildSessionPage(offset = 0, limit?: number) {
		const normalizedOffset = Math.max(0, offset);
		const normalizedLimit = normalizeSessionPageLimit(limit);
		const allSessions = listSessions();
		return {
			sessions: allSessions.slice(normalizedOffset, normalizedOffset + normalizedLimit),
			offset: normalizedOffset,
			limit: normalizedLimit,
			total: allSessions.length,
		};
	}

	function broadcast(payload: ServerMessage) {
		for (const client of clients.values()) {
			if (client.closed || !client.ready) {
				continue;
			}

			sendClientPayload(client.clientId, payload);
		}
	}

	function sendSessionPage(clientId: string, offset = 0, limit?: number) {
		sendClientPayload(clientId, {
			type: "sessions_page",
			...buildSessionPage(offset, limit),
		}, { requireReady: false });
	}

	function broadcastSessionSummaryUpdated(session: SharedSessionState) {
		broadcast({
			type: "session_summary_updated",
			session: buildSessionSummary(session),
		});
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

	function createHttpClientMessageHandler(
		handleClientMessage: (clientId: string, message: ClientAppMessage) => Promise<void>,
	) {
		return async function handleHttpClientMessage(request: Request, clientId: string): Promise<Response> {
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
		};
	}

	return {
		sendClientPayload,
		sendError,
		sendConnected,
		broadcast,
		sendSessionPage,
		broadcastSessionSummaryUpdated,
		sendSessionSnapshot,
		broadcastSessionSnapshot,
		registerClientConnection,
		removeClientConnection,
		normalizeSessionPageLimit,
		listSessions,
		buildSessionPage,
		createSseStreamResponse,
		createHttpClientMessageHandler,
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}
