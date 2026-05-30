import { createInterface } from "node:readline";
import { access, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Server as HttpServer } from "node:http";
import {
	ADMIN_PROVIDERS_PATH,
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
	type SetDefaultModelRequest,
} from "@apreal/shared";
import { createChatStore } from "../chat-store.ts";
import { getConfiguredToolsLabel } from "../agent-tools.ts";
import { getAprealServerDatabasePath } from "../agent-dir.ts";
import { createLogger } from "../logger.ts";
import {
	ensureRelayAgentAuth,
	getRelayServerUrl,
} from "../relay-auth.ts";
import { createCustomTools } from "../tools/index.ts";
import { createJobExecutor, JobStore, Scheduler } from "../scheduled-jobs/index.ts";
import { buildProvidersPayload, getErrorMessage, prewarmAgentRuntime, setDefaultProviderModel } from "../session.ts";
import { createClientManager, type Logger } from "./client-manager.ts";
import { createHandlers } from "./handlers.ts";
import { startHttpServer } from "./http-server.ts";
import { buildSessionSummary, type SharedSessionState } from "./session-state.ts";
import {
	createRelay,
	type RelayMutableState,
} from "./relay.ts";
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
} from "./utils.ts";

export type {
	SessionSummary,
	SharedSessionState,
	TranscriptMessage,
	TranscriptMessageSegment,
	TranscriptTextSegment,
	TranscriptThinkingSegment,
	TranscriptToolCall,
	TranscriptToolCallSegment,
} from "./session-state.ts";

const WEB_DIST_DIR = resolve(SERVER_SRC_DIR, "..", "..", "..", "web", "dist");
const WEB_INDEX_PATH = join(WEB_DIST_DIR, "index.html");
const ADMIN_JOBS_PATH = "/api/admin/jobs";
const ADMIN_JOBS_PATH_PREFIX = `${ADMIN_JOBS_PATH}/`;

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

function parseAdminJobRoute(pathname: string): { jobId: string; subpath: "runs" | null } | null {
	if (!pathname.startsWith(ADMIN_JOBS_PATH_PREFIX)) {
		return null;
	}

	const remainder = pathname.slice(ADMIN_JOBS_PATH_PREFIX.length);
	const [jobIdPart, subpath, ...rest] = remainder.split("/").filter(Boolean);
	if (!jobIdPart || rest.length > 0) {
		return null;
	}

	if (subpath && subpath !== "runs") {
		return null;
	}

	try {
		return {
			jobId: decodeURIComponent(jobIdPart),
			subpath: subpath === "runs" ? "runs" : null,
		};
	} catch {
		return null;
	}
}

function listScheduledJobRuns(jobName: string, sessions: Map<string, SharedSessionState>) {
	const prefix = `[Scheduled: ${jobName}]`;
	return [...sessions.values()]
		.filter((session) => session.title.startsWith(prefix))
		.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
		.map((session) => buildSessionSummary(session));
}

function createMissingWebUiResponse(request: Request, port: number): Response {
	const headers = new Headers({
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
	});
	if (request.method === "HEAD") {
		return new Response(null, { headers });
	}

	const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apreal server is running</title>
</head>
<body>
  <h1>Apreal server is running</h1>
  <p>The browser UI bundle is not available at this origin yet.</p>
  <p>Run <code>pnpm --dir apps/web dev</code> and open <a href="http://localhost:5173">http://localhost:5173</a>, or build <code>apps/web</code> to serve it from this server.</p>
  <p><a href="/health">Health check</a></p>
  <p><a href="${ADMIN_STATUS_PATH}">Server status</a></p>
  <p>Expected build output: <code>${WEB_DIST_DIR}</code></p>
  <p>Current server: <code>http://localhost:${port}</code></p>
</body>
</html>`;

	return new Response(body, { headers });
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

	if (requestedPath === "/") {
		return null;
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
	const sessions = new Map<string, import("./session-state.ts").SharedSessionState>();
	const dbPath = getAprealServerDatabasePath();
	const chatStore = createChatStore(dbPath);
	const jobStore = new JobStore(dbPath);
	for (const [sessionId, session] of chatStore.loadSessions()) {
		sessions.set(sessionId, session);
	}

	let customTools = createCustomTools();
	const schedulerLogger = createLogger("scheduler");
	const clientManager = createClientManager({
		logger,
		clients,
		sessions,
		getToolsLabel: () => getConfiguredToolsLabel(customTools),
	});
	const executor = createJobExecutor({
		store: jobStore,
		sessions,
		chatStore,
		clients,
		cwd,
		clientActions: clientManager,
		logger: schedulerLogger,
		getCustomTools: () => customTools,
	});
	const scheduler = new Scheduler(jobStore, schedulerLogger, executor);
	customTools = createCustomTools(jobStore, scheduler);
	const handlers = createHandlers(
		{ logger, cwd, clients, sessions, chatStore, customTools, jobStore, scheduler },
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

	void prewarmAgentRuntime(cwd).catch((error) => {
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

				if (url.pathname === ADMIN_PROVIDERS_PATH) {
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

					if (request.method === "GET") {
						try {
							return json(buildProvidersPayload(cwd), { headers: createCorsHeaders() });
						} catch (error) {
							return json(
								{ message: getErrorMessage(error) },
								{ status: 500, headers: createCorsHeaders() },
							);
						}
					}

					if (request.method === "PATCH") {
						let payload: unknown;
						try {
							payload = await request.json();
						} catch {
							return json(
								{ message: "Request body must be valid JSON." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
							return json(
								{ message: "Request body must be a JSON object." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						const { provider, modelId } = payload as Partial<SetDefaultModelRequest>;
						if (typeof provider !== "string" || provider.trim().length === 0) {
							return json(
								{ message: "provider must be a non-empty string." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}
						if (typeof modelId !== "string" || modelId.trim().length === 0) {
							return json(
								{ message: "modelId must be a non-empty string." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						try {
							return json(
								await setDefaultProviderModel(cwd, provider.trim(), modelId.trim()),
								{ headers: createCorsHeaders() },
							);
						} catch (error) {
							return json(
								{ message: getErrorMessage(error) },
								{ status: 400, headers: createCorsHeaders() },
							);
						}
					}

					return new Response("Method Not Allowed", {
						status: 405,
						headers: createCorsHeaders(),
					});
				}

				if (url.pathname === ADMIN_JOBS_PATH) {
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

					return json(
						{
							jobs: jobStore.listAllJobs(),
						},
						{
							headers: createCorsHeaders(),
						},
					);
				}

				const adminJobRoute = parseAdminJobRoute(url.pathname);
				if (adminJobRoute) {
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

					const job = jobStore.getJob(adminJobRoute.jobId);
					if (!job) {
						return json(
							{ message: "Scheduled job not found." },
							{ status: 404, headers: createCorsHeaders() },
						);
					}

					if (adminJobRoute.subpath === "runs") {
						if (request.method !== "GET") {
							return new Response("Method Not Allowed", {
								status: 405,
								headers: createCorsHeaders(),
							});
						}

						const runs = listScheduledJobRuns(job.name, sessions);
						return json(
							{
								jobId: job.id,
								jobName: job.name,
								count: runs.length,
								runs,
							},
							{
								headers: createCorsHeaders(),
							},
						);
					}

					if (request.method === "PATCH") {
						let payload: unknown;
						try {
							payload = await request.json();
						} catch {
							return json(
								{ message: "Request body must be valid JSON." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
							return json(
								{ message: "Request body must be a JSON object." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						const hasIntervalMinutes = "intervalMinutes" in payload;
						const nextIntervalMinutes = hasIntervalMinutes
							? Number((payload as Record<string, unknown>).intervalMinutes)
							: undefined;
						const hasEnabled = "enabled" in payload;
						const nextEnabled = hasEnabled ? (payload as Record<string, unknown>).enabled : null;

						if (!hasIntervalMinutes && !hasEnabled) {
							return json(
								{ message: "At least one job setting must be provided." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						if (
							hasIntervalMinutes &&
							(nextIntervalMinutes === undefined || !Number.isFinite(nextIntervalMinutes) || nextIntervalMinutes < 5)
						) {
							return json(
								{ message: "intervalMinutes must be a number greater than or equal to 5." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						if (hasEnabled && typeof nextEnabled !== "boolean") {
							return json(
								{ message: "enabled must be a boolean value." },
								{ status: 400, headers: createCorsHeaders() },
							);
						}

						let updatedJob = job;
						if (hasIntervalMinutes) {
							const nextJob = jobStore.updateInterval(job.id, Math.round((nextIntervalMinutes ?? 0) * 60_000));
							if (!nextJob) {
								return json(
									{ message: "Scheduled job not found." },
									{ status: 404, headers: createCorsHeaders() },
								);
							}
							updatedJob = nextJob;
						}

						if (hasEnabled) {
							const nextJob = nextEnabled ? jobStore.resumeJob(job.id) : jobStore.pauseJob(job.id);
							if (!nextJob) {
								return json(
									{ message: "Scheduled job not found." },
									{ status: 404, headers: createCorsHeaders() },
								);
							}
							updatedJob = nextJob;
						}

						if (updatedJob.enabled) {
							scheduler.scheduleJob(updatedJob);
						} else {
							await scheduler.reschedule(updatedJob.id);
						}

						return json(
							{ job: updatedJob },
							{
								headers: createCorsHeaders(),
							},
						);
					}

					if (request.method === "DELETE") {
						jobStore.deleteJob(job.id);
						await scheduler.reschedule(job.id);
						return json(
							{ ok: true, jobId: job.id },
							{
								headers: createCorsHeaders(),
							},
						);
					}

					if (request.method === "GET") {
						return json(
							{ job },
							{
								headers: createCorsHeaders(),
							},
						);
					}

					return new Response("Method Not Allowed", {
						status: 405,
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

					const normalizedRelativePath = url.pathname === "/"
						? "index.html"
						: url.pathname.replace(/^\/+/, "");
					if (!webUiReady && (url.pathname === "/" || !extname(normalizedRelativePath))) {
						return createMissingWebUiResponse(request, listeningPort);
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

	await scheduler.start();
	const activeJobCount = jobStore.listEnabledJobs().length;

	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		scheduler.stop();
		commandInput.close();
		relayState.transportGeneration += 1;
		relayState.transportAbortController?.abort();
		server.close((error) => {
			if (error) {
				logger.error("failed to shut down web server cleanly", {
					error: getErrorMessage(error),
				});
				process.exit(1);
				return;
			}

			process.exit(0);
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

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
	if (webUiReady) {
		console.log(`Frontend UI: http://localhost:${listeningPort}`);
	} else {
		console.log(`Frontend setup page: http://localhost:${listeningPort}`);
		console.log("Browser UI bundle missing. Run `pnpm --dir apps/web dev` for the Vite UI at http://localhost:5173, or build apps/web for same-origin serving.");
	}
	console.log(`Health check: http://localhost:${listeningPort}/health`);
	console.log(`Settings API: http://localhost:${listeningPort}${ADMIN_STATUS_PATH}`);
	console.log(`Relay auth: ${relayUrl}`);
	console.log(`Agent id: ${relayState.auth?.agentId ?? "not registered"}`);
	console.log(`Scheduled jobs: ${activeJobCount} active`);
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
