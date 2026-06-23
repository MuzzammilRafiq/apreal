import {
	ADMIN_APPEND_SYSTEM_PROMPT_PATH,
	ADMIN_MCP_PATH,
	ADMIN_MCP_REFRESH_PATH,
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_AUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	LOCAL_AUTH_SESSION_PATH,
	type CreateMcpServerRequest,
	type AvailableSkill,
	type AvailableTool,
	type LocalAuthSessionResponse,
	type LocalWebAdminStatus,
	type McpServerConfig,
	type McpServerRuntimeStatus,
	type McpServersResponse,
	type ProviderApiKeyRequest,
	type ProviderApiKeyResponse,
	type ProviderLoginRequest,
	type ProviderLoginResponse,
	type ProviderLoginState,
	type ProviderLoginStatus,
	type ProvidersResponse,
	type RelayAuthenticateRequest,
	type RelayAuthenticateResponse,
	type SetDefaultModelRequest,
	type UpdateAppendSystemPromptRequest,
	type UpdateAppendSystemPromptResponse,
	type UpdateMcpServerRequest,
} from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";
import { localSessionFetch } from "./local-session";

const ADMIN_JOBS_PATH = "/api/admin/jobs";
const ADMIN_JOB_RUNS_PATH_SUFFIX = "/runs";
const ADMIN_MCP_PATH_PREFIX = `${ADMIN_MCP_PATH}/`;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResponseMessage(payload: unknown, fallback: string): string {
	if (isObjectRecord(payload) && typeof payload.message === "string") {
		return payload.message;
	}

	return fallback;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function requestJson(
	requestUrl: string,
	init: RequestInit,
	failureMessage: string,
): Promise<unknown> {
	const response = await localSessionFetch(requestUrl, init);
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `${failureMessage} failed with status ${response.status}`));
	}

	return payload;
}

function jsonBodyRequest(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(body),
	};
}

const getJsonRequest: RequestInit = {
	method: "GET",
	headers: {
		accept: "application/json",
	},
};

const deleteJsonRequest: RequestInit = {
	method: "DELETE",
	headers: {
		accept: "application/json",
	},
};

function parseAvailableTool(payload: unknown): AvailableTool {
	if (
		!isObjectRecord(payload) ||
		typeof payload.name !== "string" ||
		typeof payload.label !== "string" ||
		typeof payload.description !== "string" ||
		(payload.kind !== "built_in" && payload.kind !== "custom")
	) {
		throw new Error("Server status returned an invalid response.");
	}

	return payload as AvailableTool;
}

function parseAvailableSkill(payload: unknown): AvailableSkill {
	if (
		!isObjectRecord(payload) ||
		typeof payload.name !== "string" ||
		typeof payload.description !== "string" ||
		typeof payload.sourceLabel !== "string" ||
		typeof payload.location !== "string" ||
		(payload.source !== "project" &&
			payload.source !== "user" &&
			payload.source !== "extension" &&
			payload.source !== "path" &&
			payload.source !== "temporary")
	) {
		throw new Error("Server status returned an invalid response.");
	}

	return payload as AvailableSkill;
}

function parseStatus(payload: unknown): LocalWebAdminStatus {
	if (!isObjectRecord(payload)) {
		throw new Error("Server status returned an invalid response.");
	}

	if (
		payload.service !== "web-server" ||
		typeof payload.port !== "number" ||
		typeof payload.cwd !== "string" ||
		typeof payload.relayUrl !== "string" ||
		typeof payload.relayReady !== "boolean" ||
		typeof payload.relayTransportConnected !== "boolean" ||
		typeof payload.webUiReady !== "boolean" ||
		typeof payload.webUiPath !== "string" ||
		typeof payload.appendSystemPrompt !== "string" ||
		typeof payload.appendSystemPromptPath !== "string" ||
		!Array.isArray(payload.availableTools) ||
		!Array.isArray(payload.availableSkills)
	) {
		throw new Error("Server status returned an invalid response.");
	}

	return {
		...payload,
		availableTools: payload.availableTools.map(parseAvailableTool),
		availableSkills: payload.availableSkills.map(parseAvailableSkill),
	} as LocalWebAdminStatus;
}

function parseScheduledJobs(payload: unknown): ScheduledJobDetails[] {
	if (!isObjectRecord(payload) || !Array.isArray(payload.jobs)) {
		throw new Error("Scheduled jobs returned an invalid response.");
	}

	return payload.jobs.map(parseScheduledJob);
}

function parseScheduledJob(job: unknown): ScheduledJobDetails {
	if (
		!isObjectRecord(job) ||
		typeof job.id !== "string" ||
		typeof job.name !== "string" ||
		typeof job.prompt !== "string" ||
		typeof job.intervalMs !== "number" ||
		typeof job.enabled !== "boolean" ||
		typeof job.nextRunAt !== "number" ||
		typeof job.createdAt !== "number" ||
		typeof job.updatedAt !== "number" ||
		typeof job.runCount !== "number" ||
		typeof job.maxCatchup !== "number" ||
		(job.lastRunAt !== null && typeof job.lastRunAt !== "number") ||
		(job.lastError !== null && typeof job.lastError !== "string")
	) {
		throw new Error("Scheduled jobs returned an invalid response.");
	}

	return job as ScheduledJobDetails;
}

function parseContextUsage(payload: unknown): SessionSummary["contextUsage"] {
	if (payload === null) {
		return null;
	}

	if (
		!isObjectRecord(payload) ||
		typeof payload.tokens !== "number" ||
		typeof payload.contextWindow !== "number" ||
		(payload.percent !== null && typeof payload.percent !== "number")
	) {
		throw new Error("Session summary returned an invalid response.");
	}

	return {
		tokens: payload.tokens,
		contextWindow: payload.contextWindow,
		percent: payload.percent,
	};
}

function parseSessionSummary(payload: unknown): SessionSummary {
	if (
		!isObjectRecord(payload) ||
		typeof payload.id !== "string" ||
		typeof payload.title !== "string" ||
		typeof payload.preview !== "string" ||
		typeof payload.createdAt !== "number" ||
		typeof payload.updatedAt !== "number" ||
		typeof payload.revision !== "number" ||
		typeof payload.busy !== "boolean" ||
		!(payload.model === null || typeof payload.model === "string") ||
		typeof payload.messageCount !== "number"
	) {
		throw new Error("Session summary returned an invalid response.");
	}

	return {
		id: payload.id,
		title: payload.title,
		preview: payload.preview,
		createdAt: payload.createdAt,
		updatedAt: payload.updatedAt,
		revision: payload.revision,
		busy: payload.busy,
		model: payload.model,
		messageCount: payload.messageCount,
		contextUsage: parseContextUsage(payload.contextUsage),
	};
}

function parseSessionSummaries(payload: unknown): SessionSummary[] {
	if (!isObjectRecord(payload) || !Array.isArray(payload.runs)) {
		throw new Error("Scheduled job runs returned an invalid response.");
	}

	return payload.runs.map(parseSessionSummary);
}

export async function readLocalAdminStatus(statusUrl: string): Promise<LocalWebAdminStatus> {
	const payload = await requestJson(statusUrl, getJsonRequest, "Server status");
	return parseStatus(payload);
}

export async function authenticateRelayWithOwnerGrant(
	ownerGrant: string,
	requestUrl = ADMIN_RELAY_AUTHENTICATE_PATH,
): Promise<RelayAuthenticateResponse> {
	const requestBody: RelayAuthenticateRequest = { ownerGrant };
	const payload = await requestJson(requestUrl, jsonBodyRequest("POST", requestBody), "Relay authentication");
	if (!isObjectRecord(payload) || !("status" in payload) || typeof payload.sessionSecret !== "string") {
		throw new Error("Relay authentication returned an invalid response.");
	}

	return {
		status: parseStatus(payload.status),
		sessionSecret: payload.sessionSecret,
	};
}

export async function readLocalAuthSession(
	requestUrl = LOCAL_AUTH_SESSION_PATH,
): Promise<LocalAuthSessionResponse> {
	const payload = await requestJson(requestUrl, getJsonRequest, "Local auth status");
	if (!isObjectRecord(payload) || typeof payload.authenticated !== "boolean") {
		throw new Error("Local auth status returned an invalid response.");
	}

	return {
		authenticated: payload.authenticated,
	};
}

export async function clearLocalAuthSession(requestUrl = LOCAL_AUTH_SESSION_PATH): Promise<void> {
	await requestJson(requestUrl, deleteJsonRequest, "Local auth sign-out");
}

export async function saveAppendSystemPrompt(
	appendSystemPrompt: string,
	requestUrl = ADMIN_APPEND_SYSTEM_PROMPT_PATH,
): Promise<UpdateAppendSystemPromptResponse> {
	const requestBody: UpdateAppendSystemPromptRequest = { appendSystemPrompt };
	const payload = await requestJson(requestUrl, jsonBodyRequest("POST", requestBody), "System prompt update");
	if (!isObjectRecord(payload) || !("status" in payload)) {
		throw new Error("System prompt update returned an invalid response.");
	}

	return {
		status: parseStatus(payload.status),
	};
}

export async function readScheduledJobs(requestUrl = ADMIN_JOBS_PATH): Promise<ScheduledJobDetails[]> {
	const payload = await requestJson(requestUrl, getJsonRequest, "Scheduled jobs request");
	return parseScheduledJobs(payload);
}

export async function readScheduledJobRuns(jobId: string): Promise<SessionSummary[]> {
	const payload = await requestJson(
		`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}${ADMIN_JOB_RUNS_PATH_SUFFIX}`,
		getJsonRequest,
		"Scheduled job runs request",
	);
	return parseSessionSummaries(payload);
}

export async function updateScheduledJob(
	jobId: string,
	requestBody: { intervalMinutes?: number; enabled?: boolean },
): Promise<ScheduledJobDetails> {
	const payload = await requestJson(
		`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}`,
		jsonBodyRequest("PATCH", requestBody),
		"Scheduled job update",
	);
	if (!isObjectRecord(payload) || !("job" in payload)) {
		throw new Error("Scheduled job update returned an invalid response.");
	}

	return parseScheduledJob(payload.job);
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
	await requestJson(
		`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}`,
		deleteJsonRequest,
		"Scheduled job delete",
	);
}

export {
	ADMIN_APPEND_SYSTEM_PROMPT_PATH,
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_JOBS_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_AUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
};

function isProviderLoginStatus(value: unknown): value is ProviderLoginStatus {
	return value === "idle" || value === "pending" || value === "succeeded" || value === "failed";
}

function parseProviderLoginState(payload: unknown): ProviderLoginState {
	if (
		!isObjectRecord(payload) ||
		!isProviderLoginStatus(payload.status) ||
		(payload.authUrl !== null && typeof payload.authUrl !== "string") ||
		(payload.error !== null && typeof payload.error !== "string") ||
		(payload.updatedAt !== null && typeof payload.updatedAt !== "number")
	) {
		throw new Error("Provider login state returned an invalid format.");
	}

	return {
		status: payload.status,
		authUrl: payload.authUrl,
		error: payload.error,
		updatedAt: payload.updatedAt,
	};
}

function parseProvidersResponse(payload: unknown): ProvidersResponse {
	if (
		!isObjectRecord(payload) ||
		!Array.isArray(payload.providers) ||
		(payload.defaultProvider !== null && typeof payload.defaultProvider !== "string") ||
		(payload.defaultModel !== null && typeof payload.defaultModel !== "string")
	) {
		throw new Error("Providers response returned an invalid format.");
	}

	const providers = payload.providers.map((p: unknown) => {
		if (
			!isObjectRecord(p) ||
			typeof p.id !== "string" ||
			(p.authType !== "oauth" && p.authType !== "api_key") ||
			typeof p.supportsOAuth !== "boolean" ||
			typeof p.supportsApiKey !== "boolean" ||
			!("loginState" in p) ||
			!Array.isArray(p.models)
		) {
			throw new Error("Providers response returned an invalid format.");
		}

		const models = p.models.map((m: unknown) => {
			if (!isObjectRecord(m) || typeof m.id !== "string" || typeof m.name !== "string") {
				throw new Error("Providers response returned an invalid format.");
			}
			return { id: m.id, name: m.name };
		});

		return {
			id: p.id,
			authType: p.authType as "oauth" | "api_key",
			supportsOAuth: p.supportsOAuth,
			supportsApiKey: p.supportsApiKey,
			loginState: parseProviderLoginState(p.loginState),
			models,
		};
	});

	return {
		providers,
		defaultProvider: typeof payload.defaultProvider === "string" ? payload.defaultProvider : null,
		defaultModel: typeof payload.defaultModel === "string" ? payload.defaultModel : null,
	};
}

function parseMcpServer(payload: unknown): McpServerConfig {
	if (
		!isObjectRecord(payload) ||
		typeof payload.id !== "string" ||
		typeof payload.name !== "string" ||
		(payload.transport !== "stdio" && payload.transport !== "http" && payload.transport !== "sse") ||
		typeof payload.enabled !== "boolean" ||
		!(payload.command === null || typeof payload.command === "string") ||
		!Array.isArray(payload.args) ||
		payload.args.some((entry) => typeof entry !== "string") ||
		!isObjectRecord(payload.env) ||
		Object.values(payload.env).some((entry) => typeof entry !== "string") ||
		!(payload.url === null || typeof payload.url === "string") ||
		!isObjectRecord(payload.headers) ||
		Object.values(payload.headers).some((entry) => typeof entry !== "string") ||
		!(payload.runtime === undefined || payload.runtime === null || isObjectRecord(payload.runtime)) ||
		typeof payload.createdAt !== "number" ||
		typeof payload.updatedAt !== "number"
	) {
		throw new Error("MCP servers response returned an invalid format.");
	}

	let runtime: McpServerRuntimeStatus | undefined;
	if (payload.runtime !== undefined && payload.runtime !== null) {
		if (
			(payload.runtime.state !== "idle" && payload.runtime.state !== "connecting" && payload.runtime.state !== "ready" && payload.runtime.state !== "error" && payload.runtime.state !== "disabled") ||
			typeof payload.runtime.toolCount !== "number" ||
			!(payload.runtime.lastError === null || typeof payload.runtime.lastError === "string") ||
			!(payload.runtime.updatedAt === null || typeof payload.runtime.updatedAt === "number")
		) {
			throw new Error("MCP servers response returned an invalid format.");
		}

		runtime = payload.runtime as McpServerRuntimeStatus;
	}

	return {
		...(payload as McpServerConfig),
		runtime,
	};
}

function parseMcpServersResponse(payload: unknown): McpServersResponse {
	if (!isObjectRecord(payload) || !Array.isArray(payload.servers)) {
		throw new Error("MCP servers response returned an invalid format.");
	}

	return {
		servers: payload.servers.map(parseMcpServer),
	};
}

export async function readProviders(): Promise<ProvidersResponse> {
	const payload = await requestJson(ADMIN_PROVIDERS_PATH, getJsonRequest, "Providers request");
	return parseProvidersResponse(payload);
}

export async function updateDefaultModel(requestBody: SetDefaultModelRequest): Promise<ProvidersResponse> {
	const payload = await requestJson(
		ADMIN_PROVIDERS_PATH,
		jsonBodyRequest("PATCH", requestBody),
		"Default model update",
	);
	return parseProvidersResponse(payload);
}

export async function startProviderLogin(provider: string): Promise<ProviderLoginResponse> {
	const requestBody: ProviderLoginRequest = { provider };
	const payload = await requestJson(
		ADMIN_PROVIDER_LOGIN_PATH,
		jsonBodyRequest("POST", requestBody),
		"Provider login",
	);
	if (!isObjectRecord(payload) || typeof payload.provider !== "string" || !("loginState" in payload)) {
		throw new Error("Provider login returned an invalid response.");
	}

	return {
		...parseProvidersResponse(payload),
		provider: payload.provider,
		loginState: parseProviderLoginState(payload.loginState),
	};
}

export async function saveProviderApiKey(provider: string, apiKey: string): Promise<ProviderApiKeyResponse> {
	const requestBody: ProviderApiKeyRequest = { provider, apiKey };
	const payload = await requestJson(
		ADMIN_PROVIDER_API_KEY_PATH,
		jsonBodyRequest("POST", requestBody),
		"Saving API key",
	);
	if (!isObjectRecord(payload) || typeof payload.provider !== "string") {
		throw new Error("Provider API key save returned an invalid response.");
	}

	return {
		...parseProvidersResponse(payload),
		provider: payload.provider,
	};
}

export async function readMcpServers(): Promise<McpServersResponse> {
	const payload = await requestJson(ADMIN_MCP_PATH, getJsonRequest, "MCP servers request");
	return parseMcpServersResponse(payload);
}

export async function createMcpServer(requestBody: CreateMcpServerRequest): Promise<McpServersResponse> {
	const payload = await requestJson(ADMIN_MCP_PATH, jsonBodyRequest("POST", requestBody), "MCP server create");
	return parseMcpServersResponse(payload);
}

export async function updateMcpServer(serverId: string, requestBody: UpdateMcpServerRequest): Promise<McpServersResponse> {
	const payload = await requestJson(
		`${ADMIN_MCP_PATH_PREFIX}${encodeURIComponent(serverId)}`,
		jsonBodyRequest("PATCH", requestBody),
		"MCP server update",
	);
	return parseMcpServersResponse(payload);
}

export async function deleteMcpServer(serverId: string): Promise<McpServersResponse> {
	const payload = await requestJson(
		`${ADMIN_MCP_PATH_PREFIX}${encodeURIComponent(serverId)}`,
		deleteJsonRequest,
		"MCP server delete",
	);
	return parseMcpServersResponse(payload);
}

export async function refreshMcpServers(): Promise<McpServersResponse> {
	const payload = await requestJson(ADMIN_MCP_REFRESH_PATH, {
		method: "POST",
		headers: {
			accept: "application/json",
		},
	}, "MCP server refresh");
	return parseMcpServersResponse(payload);
}
