import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server as HttpServer } from "node:http";
import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
} from "@apreal/shared";
import { createChatStore } from "./chat-store.ts";
import { createLogger } from "./logger.ts";
import {
	ensureRelayAgentAuth,
	getRelayServerUrl,
} from "./relay-auth.ts";
import { getErrorMessage, prewarmAgentRuntime } from "./session.ts";
import { createClientManager, type Logger } from "./web-client-manager.ts";
import { createHandlers } from "./web-handlers.ts";
import { startHttpServer } from "./web-http-server.ts";
import {
	createRelay,
	type RelayMutableState,
} from "./web-relay.ts";
import {
	createCorsHeaders,
	isDirectExecution,
	json,
	parsePort,
	DEFAULT_PORT,
	DEFAULT_WORKSPACE_ROOT,
	SERVER_SRC_DIR,
	type ClientConnection,
	type ServerMessage,
} from "./web-utils.ts";

export type {
	SessionSummary,
	SharedSessionState,
	TranscriptMessage,
	TranscriptMessageSegment,
	TranscriptTextSegment,
	TranscriptThinkingSegment,
	TranscriptToolCall,
	TranscriptToolCallSegment,
} from "./web-session-state.ts";

export async function runWebServer(options?: { cwd?: string; port?: number }) {
	const cwd = options?.cwd ?? process.env.PI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
	const port = options?.port ?? parsePort(process.env.PORT);
	const logger = createLogger("web-server");
	const relayUrl = getRelayServerUrl();

	const relayState: RelayMutableState = {
		auth: null,
		startupError: null,
		transportConnected: false,
		transportGeneration: 0,
		transportAbortController: null,
		reauthPending: false,
		reauthRunning: false,
	};

	try {
		relayState.auth = await ensureRelayAgentAuth(logger, relayUrl);
	} catch (error) {
		relayState.startupError = getErrorMessage(error);
		logger.warn("relay registration unavailable during startup", {
			relayUrl,
			error: relayState.startupError,
		});
	}

	const clients = new Map<string, ClientConnection>();
	const sessions = new Map<string, import("./web-session-state.ts").SharedSessionState>();
	const chatStore = createChatStore(join(homedir(), ".pi", "agent", "sessions.db"));
	for (const [sessionId, session] of chatStore.loadSessions()) {
		sessions.set(sessionId, session);
	}

	const clientManager = createClientManager({ logger, clients, sessions });
	const handlers = createHandlers(
		{ logger, cwd, clients, sessions, chatStore },
		clientManager,
	);
	const relay = createRelay(
		{ logger, relayUrl, relayState, clients },
		clientManager,
		handlers.handleClientMessage,
	);
	const handleHttpClientMessage = clientManager.createHttpClientMessageHandler(handlers.handleClientMessage);

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

		if (relayState.reauthPending) {
			void relay.handleReauthenticationInput(trimmed);
			return;
		}

		const directReauthMatch = /^reauthenticate\s+(.+)$/i.exec(trimmed);
		if (directReauthMatch?.[1]) {
			void relay.handleReauthenticationInput(directReauthMatch[1]);
			return;
		}

		if (/^reauthenticate$/i.test(trimmed)) {
			relayState.reauthPending = true;
			console.log("Enter the browser authentication code:");
		}
	});

	if (relayState.auth?.token) {
		relay.restartRelayTransport();
	}

	void prewarmAgentRuntime().catch((error) => {
		logger.warn("agent runtime prewarm failed", {
			error: getErrorMessage(error),
		});
	});

	let server: HttpServer;
	let listeningPort = port;
	try {
		const startedServer = await startHttpServer(port, async (request) => {
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
						const auth = await relay.authenticateClientRequest(request);
						return clientManager.createSseStreamResponse(request, auth.clientId);
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: relay.getClientAuthErrorStatus(error), headers: createCorsHeaders() },
						);
					}
				}

				if (url.pathname === CLIENT_MESSAGE_PATH) {
					try {
						const auth = await relay.authenticateClientRequest(request);
						return handleHttpClientMessage(request, auth.clientId);
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: relay.getClientAuthErrorStatus(error), headers: createCorsHeaders() },
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
						relayReady: Boolean(relayState.auth),
						relayTransportConnected: relayState.transportConnected,
						agentId: relayState.auth?.agentId ?? null,
						relayUrl,
						relayStartupError: relayState.startupError,
						cwd,
					});
				}

				return new Response("Not Found", { status: 404 });
			});
			server = startedServer.server;
			listeningPort = startedServer.port;
	} catch (error) {
		logger.error("failed to start web server", {
			port,
			error: getErrorMessage(error),
		});
		throw error;
	}

	logger.info("web server ready", {
		cwd,
		port: listeningPort,
		logLevel: process.env.LOG_LEVEL ?? "info",
		transport: "http-sse+relay",
		agentId: relayState.auth?.agentId ?? null,
		relayUrl,
		relayReady: Boolean(relayState.auth),
		relayTransportConnected: relayState.transportConnected,
	});
	console.log(`Pi web server ready in ${cwd}`);
	console.log("Frontend UI: http://localhost:5173");
	console.log(`Health check: http://localhost:${listeningPort}/health`);
	console.log(`Relay auth: ${relayUrl}`);
	console.log(`Agent id: ${relayState.auth?.agentId ?? "not registered"}`);
	if (relayState.startupError) {
		console.log(`Relay registration status: ${relayState.startupError}`);
	}
	console.log(`Relay transport: ${relayState.transportConnected ? "connected" : "connecting"}`);
	console.log("Browser chat sessions are shared across tabs while the server is running.");
	console.log("Type 'reauthenticate' to pair this server with a newly generated browser code.");

	return server;
}

if (isDirectExecution(import.meta.url)) {
	void runWebServer();
}
