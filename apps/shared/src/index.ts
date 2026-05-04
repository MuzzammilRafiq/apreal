export const CLIENT_EVENT_STREAM_PATH = "/api/client/stream";
export const CLIENT_MESSAGE_PATH = "/api/client/message";
export const ADMIN_STATUS_PATH = "/api/admin/status";
export const ADMIN_RELAY_REAUTHENTICATE_PATH = "/api/admin/relay/reauthenticate";
export const RELAY_CLIENT_AUTH_PATH = "/api/relay/auth/client";
export const RELAY_CLIENT_HEARTBEAT_PATH = "/api/relay/heartbeat";
export const RELAY_AGENT_AUTH_PATH = "/api/relay/auth/agent";
export const RELAY_AGENT_STREAM_PATH = "/api/relay/agent/stream";
export const RELAY_AGENT_MESSAGE_PATH = "/api/relay/agent/message";
export const RELAY_CONNECTION_PATH = "/api/relay/connection";
export const RELAY_PRINCIPAL_TYPES = ["agent", "client"] as const;
export const LOCAL_CLIENT_ID_HEADER = "x-pi-local-client-id";
export const LOCAL_CLIENT_ID_QUERY_PARAM = "clientId";

export type RelayPrincipalType = (typeof RELAY_PRINCIPAL_TYPES)[number];

export type RelayAuthTarget = {
	id: string;
	type: RelayPrincipalType;
};

export type RelayClientAuthRequest = {
	clientId: string;
	clientKey: string;
};

export type RelayClientAuthResponse = {
	clientId: string;
	clientKey: string;
	token: string;
	expiresAt: number;
	pairingCode: string | null;
	target: RelayAuthTarget | null;
	paired: boolean;
};

export type RelayAgentAuthRequest = {
	agentId: string;
	agentKey: string;
	serverUrl?: string;
	pairingCode?: string | null;
};

export type RelayAgentAuthResponse = {
	agentId: string;
	agentKey: string;
	token: string;
	expiresAt: number;
	target: RelayAuthTarget;
	paired: true;
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

export type RelayClientHeartbeatResponse = RelayClientAuthResponse & {
	serverReady: boolean;
	transportReady: boolean;
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
	reauthPending: boolean;
	reauthRunning: boolean;
	webUiReady: boolean;
	webUiPath: string;
};

export type RelayReauthenticateRequest = {
	pairingCode: string;
};

export type RelayReauthenticateResponse = {
	status: LocalWebAdminStatus;
};

export type RelayAgentCommand =
	| {
		type: "client_connect";
		clientId: string;
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

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const PAIRING_CODE_PATTERN = /^[A-Z0-9]{6,16}$/;

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

export function normalizeRelayPairingCode(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "");
	if (!PAIRING_CODE_PATTERN.test(normalized)) {
		return null;
	}

	return normalized;
}

export function assertRelayPrincipalId(value: unknown, field = "id"): string {
	const normalized = normalizeRelayPrincipalId(value);
	if (!normalized) {
		throw new Error(`invalid relay principal id: ${field}`);
	}

	return normalized;
}

export function assertRelayPairingCode(value: unknown, field = "pairingCode"): string {
	const normalized = normalizeRelayPairingCode(value);
	if (!normalized) {
		throw new Error(`invalid relay pairing code: ${field}`);
	}

	return normalized;
}
