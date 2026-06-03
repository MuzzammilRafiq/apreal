import { createInterface } from "node:readline";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Server as HttpServer } from "node:http";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
	ADMIN_APPEND_SYSTEM_PROMPT_PATH,
	ADMIN_MCP_PATH,
	ADMIN_MCP_REFRESH_PATH,
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	LOCAL_CLIENT_ID_HEADER,
	LOCAL_CLIENT_ID_QUERY_PARAM,
	normalizeRelayPairingCode,
	normalizeRelayPrincipalId,
	type CreateMcpServerRequest,
	type LocalWebAdminStatus,
	type McpServersResponse,
	type ProviderApiKeyRequest,
	type ProviderApiKeyResponse,
	type ProviderLoginRequest,
	type ProviderLoginResponse,
	type ProviderLoginState,
	type RelayReauthenticateRequest,
	type RelayReauthenticateResponse,
	type SetDefaultModelRequest,
	type UpdateAppendSystemPromptRequest,
	type UpdateAppendSystemPromptResponse,
	type UpdateMcpServerRequest,
} from "@apreal/shared";
import { createChatStore } from "../chat-store.ts";
import { getConfiguredToolInventory, getConfiguredToolsLabel } from "../agent-tools.ts";
import { getAprealAgentPath, getAprealServerDatabasePath } from "../agent-dir.ts";
import { createLogger } from "../logger.ts";
import { McpToolRegistry } from "../mcp-tools.ts";
import { McpStore } from "../mcp-store.ts";
import {
	ensureRelayAgentAuth,
	getRelayServerUrl,
} from "../relay-auth.ts";
import { createCustomTools } from "../tools/index.ts";
import { createJobExecutor, JobStore, Scheduler } from "../scheduled-jobs/index.ts";
import { buildProvidersPayload, getAvailableSkills, getErrorMessage, prewarmAgentRuntime, setDefaultProviderModel } from "../session.ts";
import { createClientManager, type Logger } from "./client-manager.ts";
import { createHandlers } from "./handlers.ts";
import { startHttpServer } from "./http-server.ts";
import { WEB_DIST_DIR, WEB_INDEX_PATH, createMissingWebUiResponse, createStaticResponse } from "./web-static.ts";
import { createWebRequestHandler } from "./web-request-handler.ts";
import { buildSessionSummary, type SharedSessionState } from "./session-state.ts";

const APREAL_AGENT_AUTH_PATH = getAprealAgentPath("auth.json");
const APREAL_AGENT_MCP_PATH = getAprealAgentPath("mcp.json");
const APREAL_AGENT_APPEND_SYSTEM_PROMPT_PATH = getAprealAgentPath("APPEND_SYSTEM.md");
const ADMIN_JOBS_PATH = "/api/admin/jobs";
const ADMIN_JOBS_PATH_PREFIX = `${ADMIN_JOBS_PATH}/`;
const ADMIN_MCP_PATH_PREFIX = `${ADMIN_MCP_PATH}/`;
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

async function readAppendSystemPrompt(): Promise<string> {
	try {
		return await readFile(APREAL_AGENT_APPEND_SYSTEM_PROMPT_PATH, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return "";
		}
		throw error;
	}
}

async function writeAppendSystemPrompt(value: string): Promise<void> {
	const normalizedValue = value.trim();
	if (!normalizedValue) {
		await rm(APREAL_AGENT_APPEND_SYSTEM_PROMPT_PATH, { force: true });
		return;
	}

	await mkdir(getAprealAgentPath(), { recursive: true });
	await writeFile(APREAL_AGENT_APPEND_SYSTEM_PROMPT_PATH, normalizedValue, "utf8");
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

function parseAdminMcpRoute(pathname: string): { serverId: string } | null {
	if (!pathname.startsWith(ADMIN_MCP_PATH_PREFIX)) {
		return null;
	}

	const remainder = pathname.slice(ADMIN_MCP_PATH_PREFIX.length);
	const parts = remainder.split("/").filter(Boolean);
	if (parts.length !== 1 || !parts[0]) {
		return null;
	}

	try {
		return { serverId: decodeURIComponent(parts[0]) };
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

function createIdleProviderLoginState(): ProviderLoginState {
	return {
		status: "idle",
		authUrl: null,
		error: null,
		updatedAt: null,
	};
}

type ProviderLoginAttempt = {
	provider: string;
	state: ProviderLoginState;
	authUrlPromise: Promise<string>;
	resolveAuthUrl: (authUrl: string) => void;
	rejectAuthUrl: (error: unknown) => void;
};

function createProviderLoginAttempt(provider: string): ProviderLoginAttempt {
	let resolveAuthUrl = (_authUrl: string) => {};
	let rejectAuthUrl = (_error: unknown) => {};
	const authUrlPromise = new Promise<string>((resolve, reject) => {
		resolveAuthUrl = resolve;
		rejectAuthUrl = reject;
	});

	return {
		provider,
		state: {
			status: "pending",
			authUrl: null,
			error: null,
			updatedAt: Date.now(),
		},
		authUrlPromise,
		resolveAuthUrl,
		rejectAuthUrl,
	};
}

export async function runWebServer(options?: { cwd?: string; port?: number }) {
	const cwd = options?.cwd ?? process.env.PI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
	const port = options?.port ?? parsePort(process.env.PORT);
	const logger = createLogger("web-server");
	const relayUrl = getRelayServerUrl();
	const providerLoginAttempts = new Map<string, ProviderLoginAttempt>();
	const readProviderLoginState = (providerId: string): ProviderLoginState | null =>
		providerLoginAttempts.get(providerId)?.state ?? null;
	const buildProvidersPayloadWithLoginState = () => buildProvidersPayload(cwd, readProviderLoginState);

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
	const mcpStore = new McpStore(APREAL_AGENT_MCP_PATH);
	const mcpToolRegistry = new McpToolRegistry(cwd, createLogger("mcp"));
	const webUiReady = await fileExists(WEB_INDEX_PATH);
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
	let inventorySnapshot: Pick<LocalWebAdminStatus, "availableTools" | "availableSkills"> = {
		availableTools: getConfiguredToolInventory(customTools),
		availableSkills: [],
	};
	let inventorySnapshotExpiresAt = 0;
	let inventorySnapshotPromise: Promise<typeof inventorySnapshot> | null = null;
	const rebuildCustomTools = async () => {
		let mcpTools = [] as import("@earendil-works/pi-coding-agent").ToolDefinition[];
		try {
			const { servers } = await mcpStore.list();
			mcpTools = await mcpToolRegistry.buildTools(servers);
		} catch (error) {
			logger.warn("failed to refresh mcp tools", {
				error: getErrorMessage(error),
			});
		}

		customTools = createCustomTools(jobStore, scheduler, mcpTools);
		inventorySnapshotExpiresAt = 0;
	};
	await rebuildCustomTools();
	const handlers = createHandlers(
		{ logger, cwd, clients, sessions, chatStore, getCustomTools: () => customTools, jobStore, scheduler },
		clientManager,
	);
	const relay = createRelay(
		{ logger, relayUrl, relayState, clients },
		clientManager,
		handlers.handleClientMessage,
	);
	const handleHttpClientMessage = clientManager.createHttpClientMessageHandler(handlers.handleClientMessage);

	const readInventorySnapshot = async () => {
		const now = Date.now();
		if (now < inventorySnapshotExpiresAt) {
			return inventorySnapshot;
		}

		if (inventorySnapshotPromise) {
			return inventorySnapshotPromise;
		}

		inventorySnapshotPromise = (async () => {
			let availableSkills = inventorySnapshot.availableSkills;
			try {
				availableSkills = await getAvailableSkills(cwd);
			} catch (error) {
				logger.warn("failed to load skill inventory for web status", {
					error: getErrorMessage(error),
				});
			}

			const nextSnapshot = {
				availableTools: getConfiguredToolInventory(customTools),
				availableSkills,
			};
			inventorySnapshot = nextSnapshot;
			inventorySnapshotExpiresAt = Date.now() + 10_000;
			return nextSnapshot;
		})().finally(() => {
			inventorySnapshotPromise = null;
		});

		return inventorySnapshotPromise;
	};

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
	const buildStatusPayload = async (): Promise<LocalWebAdminStatus> => {
		const inventory = await readInventorySnapshot();
		return {
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
			appendSystemPrompt: await readAppendSystemPrompt(),
			appendSystemPromptPath: APREAL_AGENT_APPEND_SYSTEM_PROMPT_PATH,
			availableTools: inventory.availableTools,
			availableSkills: inventory.availableSkills,
		};
	};

	const recycleIdleSessionControllers = () => {
		for (const session of sessions.values()) {
			if (session.busy) {
				continue;
			}

			session.unsubscribe?.();
			session.unsubscribe = null;
			session.controller?.dispose();
			session.controller = null;
			session.controllerPromise = null;
		}
	};

	const withMcpRuntime = (response: McpServersResponse): McpServersResponse => ({
		servers: mcpToolRegistry.withRuntime(response.servers),
	});
	const readMcpServers = async (): Promise<McpServersResponse> => withMcpRuntime(await mcpStore.list());
	const createMcpServer = async (requestBody: CreateMcpServerRequest): Promise<McpServersResponse> => withMcpRuntime(await mcpStore.create(requestBody));
	const updateMcpServer = async (serverId: string, requestBody: UpdateMcpServerRequest): Promise<McpServersResponse> => withMcpRuntime(await mcpStore.update(serverId, requestBody));
	const deleteMcpServer = async (serverId: string): Promise<McpServersResponse> => withMcpRuntime(await mcpStore.delete(serverId));
	const refreshMcpServers = async (): Promise<McpServersResponse> => {
		await rebuildCustomTools();
		return readMcpServers();
	};

	const assertLocalAdminRequest = (request: Request): Response | null => {
		if (isLoopbackClientRequest(request)) {
			return null;
		}

		return json(
			{ message: "The local admin API is only available from this machine." },
			{ status: 403, headers: createCorsHeaders() },
		);
	};

	const startProviderLogin = async (providerId: string): Promise<ProviderLoginResponse> => {
		const normalizedProviderId = providerId.trim();
		if (!normalizedProviderId) {
			throw new Error("provider must be a non-empty string.");
		}

		const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
		const oauthProvider = authStorage.getOAuthProviders().find((provider) => provider.id === normalizedProviderId);
		if (!oauthProvider) {
			throw new Error(`Provider ${normalizedProviderId} does not support Pi OAuth login.`);
		}

		const existingAttempt = providerLoginAttempts.get(normalizedProviderId);
		if (existingAttempt?.state.status === "pending") {
			return {
				...buildProvidersPayloadWithLoginState(),
				provider: normalizedProviderId,
				loginState: existingAttempt.state,
			};
		}

		const attempt = createProviderLoginAttempt(normalizedProviderId);
		providerLoginAttempts.set(normalizedProviderId, attempt);

		void authStorage.login(normalizedProviderId, {
			onAuth: (info) => {
				attempt.state = {
					status: "pending",
					authUrl: info.url,
					error: null,
					updatedAt: Date.now(),
				};
				attempt.resolveAuthUrl(info.url);
			},
			onPrompt: async (prompt) => {
				throw new Error(
					`Provider ${normalizedProviderId} requested extra input (${prompt.message}). Web login currently supports browser-based Pi OAuth only.`,
				);
			},
			onSelect: async (prompt) => {
				throw new Error(
					`Provider ${normalizedProviderId} requires an interactive selection (${prompt.message}). Web login currently supports browser-based Pi OAuth only.`,
				);
			},
			onProgress: (message) => {
				logger.info("provider login progress", {
					provider: normalizedProviderId,
					message,
				});
			},
		})
			.then(() => {
				attempt.state = {
					status: "succeeded",
					authUrl: null,
					error: null,
					updatedAt: Date.now(),
				};
			})
			.catch((error) => {
				const message = getErrorMessage(error);
				attempt.state = {
					status: "failed",
					authUrl: null,
					error: message,
					updatedAt: Date.now(),
				};
				attempt.rejectAuthUrl(error);
				logger.warn("provider login failed", {
					provider: normalizedProviderId,
					error: message,
				});
			});

		try {
			await attempt.authUrlPromise;
		} catch (error) {
			throw new Error(getErrorMessage(error));
		}

		return {
			...buildProvidersPayloadWithLoginState(),
			provider: normalizedProviderId,
			loginState: attempt.state,
		};
	};

	const saveProviderApiKey = async (providerId: string, apiKey: string): Promise<ProviderApiKeyResponse> => {
		const normalizedProviderId = providerId.trim();
		const normalizedApiKey = apiKey.trim();
		if (!normalizedProviderId) {
			throw new Error("provider must be a non-empty string.");
		}
		if (!normalizedApiKey) {
			throw new Error("apiKey must be a non-empty string.");
		}

		const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
		authStorage.set(normalizedProviderId, {
			type: "api_key",
			key: normalizedApiKey,
		});

		const loginAttempt = providerLoginAttempts.get(normalizedProviderId);
		if (loginAttempt) {
			loginAttempt.state = createIdleProviderLoginState();
		}

		return {
			...buildProvidersPayloadWithLoginState(),
			provider: normalizedProviderId,
		};
	};

	const authenticateBrowserRequest = async (request: Request): Promise<{ clientId: string }> => {
		const localClientId = readLocalClientId(request);
		if (localClientId && isLoopbackClientRequest(request)) {
			return { clientId: localClientId };
		}

		return relay.authenticateClientRequest(request);
	};
	try {
		const handleWebRequest = createWebRequestHandler({
		logger, authenticateBrowserRequest, clientManager, handleHttpClientMessage, assertLocalAdminRequest, buildStatusPayload,
		writeAppendSystemPrompt, recycleIdleSessionControllers, saveProviderApiKey, startProviderLogin, buildProvidersPayloadWithLoginState,
		cwd, readProviderLoginState, refreshMcpServers, readMcpServers, createMcpServer, rebuildCustomTools, updateMcpServer, deleteMcpServer,
		jobStore, sessions, scheduler, relay, createStaticResponse, createMissingWebUiResponse, webUiReady, getListeningPort: () => listeningPort,
	});
		const startedServer = await startHttpServer(port, handleWebRequest);
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
		console.log("Browser UI bundle missing. Run `pnpm dev` for the Vite UI with hot reload at http://localhost:5173, or build apps/web for same-origin serving.");
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
