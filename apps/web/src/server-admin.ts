import {
	ADMIN_MCP_PATH,
	ADMIN_MCP_REFRESH_PATH,
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	type CreateMcpServerRequest,
	type AvailableSkill,
	type AvailableTool,
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
	type RelayReauthenticateRequest,
	type RelayReauthenticateResponse,
	type SetDefaultModelRequest,
	type UpdateMcpServerRequest,
} from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";

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
		typeof payload.reauthPending !== "boolean" ||
		typeof payload.reauthRunning !== "boolean" ||
		typeof payload.webUiReady !== "boolean" ||
		typeof payload.webUiPath !== "string" ||
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
	const response = await fetch(statusUrl, {
		method: "GET",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Server status failed with status ${response.status}`));
	}

	return parseStatus(payload);
}

export async function submitRelayReauthentication(
	requestUrl: string,
	pairingCode: string,
): Promise<RelayReauthenticateResponse> {
	const requestBody: RelayReauthenticateRequest = { pairingCode };
	const response = await fetch(requestUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Relay reauthentication failed with status ${response.status}`));
	}

	if (!isObjectRecord(payload) || !("status" in payload)) {
		throw new Error("Relay reauthentication returned an invalid response.");
	}

	return {
		status: parseStatus(payload.status),
	};
}

export async function readScheduledJobs(requestUrl = ADMIN_JOBS_PATH): Promise<ScheduledJobDetails[]> {
	const response = await fetch(requestUrl, {
		method: "GET",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Scheduled jobs request failed with status ${response.status}`));
	}

	return parseScheduledJobs(payload);
}

export async function readScheduledJobRuns(jobId: string): Promise<SessionSummary[]> {
	const response = await fetch(`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}${ADMIN_JOB_RUNS_PATH_SUFFIX}`, {
		method: "GET",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Scheduled job runs request failed with status ${response.status}`));
	}

	return parseSessionSummaries(payload);
}

export async function updateScheduledJob(
	jobId: string,
	requestBody: { intervalMinutes?: number; enabled?: boolean },
): Promise<ScheduledJobDetails> {
	const response = await fetch(`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}`, {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Scheduled job update failed with status ${response.status}`));
	}

	if (!isObjectRecord(payload) || !("job" in payload)) {
		throw new Error("Scheduled job update returned an invalid response.");
	}

	return parseScheduledJob(payload.job);
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
	const response = await fetch(`${ADMIN_JOBS_PATH}/${encodeURIComponent(jobId)}`, {
		method: "DELETE",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Scheduled job delete failed with status ${response.status}`));
	}
}

export {
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_JOBS_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_REAUTHENTICATE_PATH,
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
	const response = await fetch(ADMIN_PROVIDERS_PATH, {
		method: "GET",
		headers: { accept: "application/json" },
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Providers request failed with status ${response.status}`));
	}

	return parseProvidersResponse(payload);
}

export async function updateDefaultModel(requestBody: SetDefaultModelRequest): Promise<ProvidersResponse> {
	const response = await fetch(ADMIN_PROVIDERS_PATH, {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Default model update failed with status ${response.status}`));
	}

	return parseProvidersResponse(payload);
}

export async function startProviderLogin(provider: string): Promise<ProviderLoginResponse> {
	const requestBody: ProviderLoginRequest = { provider };
	const response = await fetch(ADMIN_PROVIDER_LOGIN_PATH, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Provider login failed with status ${response.status}`));
	}

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
	const response = await fetch(ADMIN_PROVIDER_API_KEY_PATH, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Saving API key failed with status ${response.status}`));
	}

	if (!isObjectRecord(payload) || typeof payload.provider !== "string") {
		throw new Error("Provider API key save returned an invalid response.");
	}

	return {
		...parseProvidersResponse(payload),
		provider: payload.provider,
	};
}

export async function readMcpServers(): Promise<McpServersResponse> {
	const response = await fetch(ADMIN_MCP_PATH, {
		method: "GET",
		headers: { accept: "application/json" },
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `MCP servers request failed with status ${response.status}`));
	}

	return parseMcpServersResponse(payload);
}

export async function createMcpServer(requestBody: CreateMcpServerRequest): Promise<McpServersResponse> {
	const response = await fetch(ADMIN_MCP_PATH, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `MCP server create failed with status ${response.status}`));
	}

	return parseMcpServersResponse(payload);
}

export async function updateMcpServer(serverId: string, requestBody: UpdateMcpServerRequest): Promise<McpServersResponse> {
	const response = await fetch(`${ADMIN_MCP_PATH_PREFIX}${encodeURIComponent(serverId)}`, {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `MCP server update failed with status ${response.status}`));
	}

	return parseMcpServersResponse(payload);
}

export async function deleteMcpServer(serverId: string): Promise<McpServersResponse> {
	const response = await fetch(`${ADMIN_MCP_PATH_PREFIX}${encodeURIComponent(serverId)}`, {
		method: "DELETE",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `MCP server delete failed with status ${response.status}`));
	}

	return parseMcpServersResponse(payload);
}

export async function refreshMcpServers(): Promise<McpServersResponse> {
	const response = await fetch(ADMIN_MCP_REFRESH_PATH, {
		method: "POST",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `MCP server refresh failed with status ${response.status}`));
	}

	return parseMcpServersResponse(payload);
}
