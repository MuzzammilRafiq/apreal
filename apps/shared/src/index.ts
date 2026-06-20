export const CLIENT_EVENT_STREAM_PATH = "/api/client/stream";
export const CLIENT_MESSAGE_PATH = "/api/client/message";
export const LOCAL_AUTH_SESSION_PATH = "/api/local-auth/session";
export const ADMIN_STATUS_PATH = "/api/admin/status";
export const ADMIN_RELAY_AUTHENTICATE_PATH = "/api/admin/relay/authenticate";
export const ADMIN_APPEND_SYSTEM_PROMPT_PATH = "/api/admin/system-prompt";
export const ADMIN_PROVIDER_LOGIN_PATH = "/api/admin/providers/login";
export const ADMIN_PROVIDER_API_KEY_PATH = "/api/admin/providers/api-key";
export const ADMIN_MCP_PATH = "/api/admin/mcp";
export const ADMIN_MCP_REFRESH_PATH = "/api/admin/mcp/refresh";
export const RELAY_CLIENT_AUTH_PATH = "/api/relay/auth/client";
export const RELAY_CLIENT_HEARTBEAT_PATH = "/api/relay/heartbeat";
export const RELAY_AGENT_AUTH_PATH = "/api/relay/auth/agent";
export const RELAY_AGENT_OWNER_GRANT_PATH = "/api/relay/auth/agent/owner-grant";
export const RELAY_AGENT_STREAM_PATH = "/api/relay/agent/stream";
export const RELAY_AGENT_MESSAGE_PATH = "/api/relay/agent/message";
export const RELAY_CONNECTION_PATH = "/api/relay/connection";
export const RELAY_CREDENTIALS_PATH = "/api/relay/credentials";
export const RELAY_CREDENTIAL_REVOKE_PATH = "/api/relay/credentials/revoke";
export const RELAY_PRINCIPAL_TYPES = ["agent", "client"] as const;
export const LOCAL_CLIENT_ID_HEADER = "x-pi-local-client-id";
export const LOCAL_CLIENT_ID_QUERY_PARAM = "clientId";
export const LOCAL_AUTH_SESSION_HEADER = "x-apreal-local-session";
export const LOCAL_AUTH_SESSION_QUERY_PARAM = "localSession";
export const SYNC_LAST_SEQ_QUERY_PARAM = "lastSeq";

export type ServerSyncScope = "global" | `session:${string}` | `client:${string}`;

export type ServerSyncEnvelope<TPayload = unknown> = {
	type: "sync_event";
	seq: number;
	scope: ServerSyncScope;
	emittedAt: number;
	payload: TPayload;
};

export type RelayPrincipalType = (typeof RELAY_PRINCIPAL_TYPES)[number];

export type AvailableToolKind = "built_in" | "custom";

export type AvailableTool = {
	name: string;
	label: string;
	description: string;
	kind: AvailableToolKind;
};

export type AvailableSkillSource = "project" | "user" | "extension" | "path" | "temporary";

export type AvailableSkill = {
	name: string;
	description: string;
	source: AvailableSkillSource;
	sourceLabel: string;
	location: string;
};

export type McpServerTransport = "stdio" | "http" | "sse";
export type McpServerOrigin = "user" | "built_in";

export type McpServerConfig = {
	id: string;
	name: string;
	origin: McpServerOrigin;
	transport: McpServerTransport;
	enabled: boolean;
	command: string | null;
	args: string[];
	env: Record<string, string>;
	url: string | null;
	headers: Record<string, string>;
	createdAt: number;
	updatedAt: number;
	runtime?: McpServerRuntimeStatus;
};

export type McpServerRuntimeState = "idle" | "connecting" | "ready" | "error" | "disabled";

export type McpServerRuntimeStatus = {
	state: McpServerRuntimeState;
	toolCount: number;
	lastError: string | null;
	updatedAt: number | null;
};

export type McpServersResponse = {
	servers: McpServerConfig[];
};

export type CreateMcpServerRequest = {
	name: string;
	transport: McpServerTransport;
	enabled?: boolean;
	command?: string | null;
	args?: string[];
	env?: Record<string, string>;
	url?: string | null;
	headers?: Record<string, string>;
};

export type UpdateMcpServerRequest = {
	name?: string;
	transport?: McpServerTransport;
	enabled?: boolean;
	command?: string | null;
	args?: string[];
	env?: Record<string, string>;
	url?: string | null;
	headers?: Record<string, string>;
};

export type RelayAuthTarget = {
	id: string;
	type: RelayPrincipalType;
};

export type RelayClientAuthRequest = {
	ownerGrant?: string | null;
	rotateCredential?: boolean;
};

export type RelayClientAuthResponse = {
	clientId: string;
	token: string;
	expiresAt: number;
	target: RelayAuthTarget | null;
	paired: boolean;
};

export type RelayAgentAuthRequest = {
	agentId: string;
	agentKey: string;
	serverUrl?: string;
	ownerGrant?: string | null;
	rotateCredential?: boolean;
};

export type RelayCredentialSummary = {
	credentialId: string;
	type: RelayPrincipalType;
	principalId: string;
	createdAt: number;
	updatedAt: number;
	revokedAt: number | null;
};

export type RelayCredentialsResponse = {
	credentials: RelayCredentialSummary[];
};

export type RevokeRelayCredentialRequest = {
	credentialId: string;
};

export type RelayAgentAuthResponse = {
	agentId: string;
	agentKey: string;
	token: string;
	expiresAt: number;
	target: RelayAuthTarget | null;
	paired: boolean;
};

export type RelayAgentOwnerGrantResponse = {
	ownerGrant: string;
	expiresAt: number;
};

export type RelayConnectionRequest = {
	targetId: string;
	targetType?: RelayPrincipalType;
};

export type RelayConnectionResponse = {
	principal: {
		id: string;
		type: RelayPrincipalType;
		expiresAt: number;
		scopedToTarget: boolean;
	};
	target: {
		id: string;
		type: RelayPrincipalType;
	};
};

export type RelayClientHeartbeatRequest = RelayClientAuthRequest;

export type RemoteSettingsSection = "account" | "connection" | "models" | "skills" | "mcp" | "tools" | "jobs";

export type RemoteSettingsAuthorization = {
	sections: RemoteSettingsSection[];
};

export type RelayClientHeartbeatResponse = RelayClientAuthResponse & {
	serverReady: boolean;
	transportReady: boolean;
	settingsAuthorization: RemoteSettingsAuthorization;
};

export type LocalWebAdminStatus = {
	service: "web-server";
	status: "ok";
	transport: "http-sse+relay";
	clients: number;
	sessions: number;
	port: number;
	cwd: string;
	relayUrl: string;
	relayReady: boolean;
	relayTransportConnected: boolean;
	relayStartupError: string | null;
	agentId: string | null;
	webUiReady: boolean;
	webUiPath: string;
	appendSystemPrompt: string;
	appendSystemPromptPath: string;
	availableTools: AvailableTool[];
	availableSkills: AvailableSkill[];
};

export type RelayAuthenticateRequest = {
	ownerGrant: string;
};

export type UpdateAppendSystemPromptRequest = {
	appendSystemPrompt: string;
};

export type UpdateAppendSystemPromptResponse = {
	status: LocalWebAdminStatus;
};

export const ADMIN_PROVIDERS_PATH = "/api/admin/providers";

export type ProviderModel = {
	id: string;
	name: string;
};

export type ProviderInfo = {
	id: string;
	authType: "oauth" | "api_key";
	supportsOAuth: boolean;
	supportsApiKey: boolean;
	loginState: ProviderLoginState;
	models: ProviderModel[];
};

export type ProviderLoginStatus = "idle" | "pending" | "succeeded" | "failed";

export type ProviderLoginState = {
	status: ProviderLoginStatus;
	authUrl: string | null;
	error: string | null;
	updatedAt: number | null;
};

export type ProvidersResponse = {
	providers: ProviderInfo[];
	defaultProvider: string | null;
	defaultModel: string | null;
};

export type SetDefaultModelRequest = {
	provider: string;
	modelId: string;
};

export type ProviderLoginRequest = {
	provider: string;
};

export type ProviderLoginResponse = {
	provider: string;
	loginState: ProviderLoginState;
} & ProvidersResponse;

export type ProviderApiKeyRequest = {
	provider: string;
	apiKey: string;
};

export type ProviderApiKeyResponse = {
	provider: string;
} & ProvidersResponse;

export type ClientProvidersCommand =
	| {
		type: "load_providers";
	}
	| ({
		type: "set_default_model";
	} & SetDefaultModelRequest)
	| {
		type: "start_provider_login";
		provider: string;
	}
	| {
		type: "save_provider_api_key";
		provider: string;
		apiKey: string;
	};

export type ServerProvidersMessage = {
	type: "providers_snapshot";
} & ProvidersResponse;

export type ClientStatusCommand =
	| {
		type: "load_status";
	}
	| ({
		type: "save_append_system_prompt";
	} & UpdateAppendSystemPromptRequest);

export type ServerStatusMessage =
	| {
		type: "status_snapshot";
		status: LocalWebAdminStatus;
	}
	| {
		type: "append_system_prompt_saved";
		status: LocalWebAdminStatus;
	};

export type RelayAuthenticateResponse = {
	status: LocalWebAdminStatus;
	sessionSecret: string;
};

export type LocalAuthSessionResponse = {
	authenticated: boolean;
};

export type RelayAgentCommand =
	| {
		type: "client_connect";
		clientId: string;
		lastSeq?: number;
	}
	| {
		type: "client_disconnect";
		clientId: string;
		reason?: string;
	}
	| {
		type: "client_message";
		clientId: string;
		message: unknown;
	};

export type RelayAgentMessage = {
	type: "server_message";
	clientId: string;
	message: unknown;
};

export type ScheduledJobDetails = {
	id: string;
	name: string;
	prompt: string;
	intervalMs: number;
	enabled: boolean;
	lastRunAt: number | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
	runCount: number;
	maxCatchup: number;
	lastError: string | null;
};

export type ScheduledJobUpdateRequest = {
	intervalMinutes?: number;
	enabled?: boolean;
};

export type ScheduledJobRunSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	revision: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
	contextUsage: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	} | null;
};

export type ClientJobsCommand =
	| {
		type: "load_jobs";
	}
	| {
		type: "load_job_runs";
		jobId: string;
	}
	| {
		type: "update_job";
		jobId: string;
		changes: ScheduledJobUpdateRequest;
	}
	| {
		type: "delete_job";
		jobId: string;
	};

export type ClientMcpCommand =
	| {
		type: "load_mcp_servers";
	}
	| {
		type: "create_mcp_server";
		request: CreateMcpServerRequest;
	}
	| {
		type: "update_mcp_server";
		serverId: string;
		request: UpdateMcpServerRequest;
	}
	| {
		type: "delete_mcp_server";
		serverId: string;
	}
	| {
		type: "refresh_mcp_servers";
	};

export type ServerJobsMessage =
	| {
		type: "jobs_snapshot";
		jobs: ScheduledJobDetails[];
	}
	| {
		type: "job_updated";
		job: ScheduledJobDetails;
	}
	| {
		type: "job_deleted";
		jobId: string;
	}
	| {
		type: "job_runs_snapshot";
		jobId: string;
		runs: ScheduledJobRunSummary[];
	};

export type ServerMcpMessage = {
	type: "mcp_servers_snapshot";
} & McpServersResponse;

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
export function isRelayPrincipalType(value: unknown): value is RelayPrincipalType {
	return typeof value === "string" && RELAY_PRINCIPAL_TYPES.includes(value as RelayPrincipalType);
}

export function normalizeRelayPrincipalId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!PRINCIPAL_ID_PATTERN.test(trimmed)) {
		return null;
	}

	return trimmed;
}

export function assertRelayPrincipalId(value: unknown, field = "id"): string {
	const normalized = normalizeRelayPrincipalId(value);
	if (!normalized) {
		throw new Error(`invalid relay principal id: ${field}`);
	}

	return normalized;
}
