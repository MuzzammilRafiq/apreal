import { createInterface } from "node:readline";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { Server as HttpServer } from "node:http";
import {
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	LOCAL_CLIENT_ID_HEADER,
	LOCAL_CLIENT_ID_QUERY_PARAM,
	normalizeRelayPairingCode,
	normalizeRelayPrincipalId,
	type LocalWebAdminStatus,
	type RelayReauthenticateRequest,
	type RelayReauthenticateResponse,
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
	isLoopbackClientRequest,
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

const WEB_DIST_DIR = resolve(SERVER_SRC_DIR, "..", "..", "web", "dist");
const WEB_INDEX_PATH = join(WEB_DIST_DIR, "index.html");

const CONTENT_TYPES = new Map<string, string>([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".ico", "image/x-icon"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".map", "application/json; charset=utf-8"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".svg", "image/svg+xml"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

function getContentType(filePath: string): string {
	return CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function readLocalClientId(request: Request): string | null {
	const headerClientId = normalizeRelayPrincipalId(request.headers.get(LOCAL_CLIENT_ID_HEADER));
	if (headerClientId) {
		return headerClientId;
	}

	const url = new URL(request.url);
	return normalizeRelayPrincipalId(url.searchParams.get(LOCAL_CLIENT_ID_QUERY_PARAM));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function createStaticResponse(request: Request, url: URL): Promise<Response | null> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return null;
	}

	const requestedPath = decodeURIComponent(url.pathname);
	const normalizedRelativePath = requestedPath === "/"
		? "index.html"
		: requestedPath.replace(/^\/+/, "");
	const requestedFilePath = resolve(WEB_DIST_DIR, normalizedRelativePath);
	const allowedPrefix = `${WEB_DIST_DIR}${sep}`;
	if (requestedFilePath !== WEB_DIST_DIR && !requestedFilePath.startsWith(allowedPrefix)) {
		return new Response("Not Found", { status: 404 });
	}

	const tryServeFile = async (filePath: string): Promise<Response | null> => {
		try {
			const fileStats = await stat(filePath);
			if (!fileStats.isFile()) {
				return null;
			}

			const headers = new Headers({
				"cache-control": filePath === WEB_INDEX_PATH ? "no-store" : "public, max-age=31536000, immutable",
				"content-type": getContentType(filePath),
			});
			if (request.method === "HEAD") {
				return new Response(null, { headers });
			}

			const body = await readFile(filePath);
			return new Response(body, { headers });
		} catch {
			return null;
		}
	};

	const directMatch = await tryServeFile(requestedFilePath);
	if (directMatch) {
		return directMatch;
	}

	if (extname(normalizedRelativePath)) {
		return new Response("Not Found", { status: 404 });
	}

	return tryServeFile(WEB_INDEX_PATH);
}

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
	const webUiReady = await fileExists(WEB_INDEX_PATH);

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
	const buildStatusPayload = (): LocalWebAdminStatus => ({
		service: "web-server",
		status: "ok",
		transport: "http-sse+relay",
		clients: clients.size,
		sessions: sessions.size,
		port: listeningPort,
		cwd,
		relayUrl,
		relayReady: Boolean(relayState.auth),
		relayTransportConnected: relayState.transportConnected,
		relayStartupError: relayState.startupError,
		agentId: relayState.auth?.agentId ?? null,
		reauthPending: relayState.reauthPending,
		reauthRunning: relayState.reauthRunning,
		webUiReady,
		webUiPath: WEB_DIST_DIR,
	});

	const assertLocalAdminRequest = (request: Request): Response | null => {
		if (isLoopbackClientRequest(request)) {
			return null;
		}

		return json(
			{ message: "The local admin API is only available from this machine." },
			{ status: 403, headers: createCorsHeaders() },
		);
	};

	const authenticateBrowserRequest = async (request: Request): Promise<{ clientId: string }> => {
		const localClientId = readLocalClientId(request);
		if (localClientId && isLoopbackClientRequest(request)) {
			return { clientId: localClientId };
		}

		return relay.authenticateClientRequest(request);
	};
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
						const auth = await authenticateBrowserRequest(request);
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
						const auth = await authenticateBrowserRequest(request);
						return handleHttpClientMessage(request, auth.clientId);
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: relay.getClientAuthErrorStatus(error), headers: createCorsHeaders() },
						);
					}
				}

				if (url.pathname === ADMIN_STATUS_PATH) {
					const localOnlyResponse = assertLocalAdminRequest(request);
					if (localOnlyResponse) {
						return localOnlyResponse;
					}

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

					return json(buildStatusPayload(), {
						headers: createCorsHeaders(),
					});
				}

				if (url.pathname === ADMIN_RELAY_REAUTHENTICATE_PATH) {
					const localOnlyResponse = assertLocalAdminRequest(request);
					if (localOnlyResponse) {
						return localOnlyResponse;
					}

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

					let payload: unknown;
					try {
						payload = await request.json();
					} catch {
						return json(
							{ message: "Request body must be valid JSON." },
							{ status: 400, headers: createCorsHeaders() },
						);
					}

					const pairingCode = normalizeRelayPairingCode(
						typeof (payload as RelayReauthenticateRequest | null)?.pairingCode === "string"
							? (payload as RelayReauthenticateRequest).pairingCode
							: null,
					);
					if (!pairingCode) {
						return json(
							{ message: "A valid pairing code is required." },
							{ status: 400, headers: createCorsHeaders() },
						);
					}

					try {
						await relay.reauthenticateWithPairingCode(pairingCode);
						const response: RelayReauthenticateResponse = {
							status: buildStatusPayload(),
						};
						return json(response, {
							headers: createCorsHeaders(),
						});
					} catch (error) {
						return json(
							{ message: getErrorMessage(error) },
							{ status: 400, headers: createCorsHeaders() },
						);
					}
				}

				if (url.pathname === "/health") {
					return json(buildStatusPayload());
				}

				if (!url.pathname.startsWith("/api/")) {
					const staticResponse = await createStaticResponse(request, url);
					if (staticResponse) {
						return staticResponse;
					}
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
	console.log(`Frontend UI: http://localhost:${listeningPort}`);
	console.log(`Health check: http://localhost:${listeningPort}/health`);
	console.log(`Settings API: http://localhost:${listeningPort}${ADMIN_STATUS_PATH}`);
	console.log(`Relay auth: ${relayUrl}`);
	console.log(`Agent id: ${relayState.auth?.agentId ?? "not registered"}`);
	if (relayState.startupError) {
		console.log(`Relay registration status: ${relayState.startupError}`);
	}
	if (!webUiReady) {
		console.log(`Web UI assets not found at ${WEB_DIST_DIR}. Build apps/web to serve the browser UI from the server origin.`);
	}
	console.log(`Relay transport: ${relayState.transportConnected ? "connected" : "connecting"}`);
	console.log("Browser chat sessions are shared across tabs while the server is running.");
	console.log("Type 'reauthenticate' to pair this server with a newly generated browser code.");

	return server;
}

if (isDirectExecution(import.meta.url)) {
	void runWebServer();
}
