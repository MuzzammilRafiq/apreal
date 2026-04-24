export const RELAY_BROWSER_PROTOCOL = "relay.jwt";
export const RELAY_CLIENT_ID_STORAGE_KEY = "pi-browser-client-id";
export const RELAY_BOOTSTRAP_PATH = "/api/relay/bootstrap";
export const RELAY_SESSION_ACTION = "session_message" as const;
export const RELAY_ALLOWED_ACTIONS = ["ping", "read_file", "session_message"] as const;
export const RELAY_HANDSHAKE_STATES = ["awaiting_hello", "ready"] as const;
export const RELAY_CONNECTION_STATUSES = ["online", "offline"] as const;
export const RELAY_PRINCIPAL_TYPES = ["agent", "client"] as const;
export const RELAY_MESSAGE_TYPES = ["command", "response"] as const;

export type RelayAllowedAction = (typeof RELAY_ALLOWED_ACTIONS)[number];
export type RelayHandshakeState = (typeof RELAY_HANDSHAKE_STATES)[number];
export type RelayConnectionStatus = (typeof RELAY_CONNECTION_STATUSES)[number];
export type RelayPrincipalType = (typeof RELAY_PRINCIPAL_TYPES)[number];
export type RelayMessageType = (typeof RELAY_MESSAGE_TYPES)[number];

export type RelayRegistrationRecord = {
	principalId: string;
	principalType: RelayPrincipalType;
	connectionStatus: RelayConnectionStatus;
	handshakeState: RelayHandshakeState;
	lastAuthenticatedAt: number;
	lastConnectedAt: number | null;
	lastDisconnectedAt: number | null;
};

export type RelayPairingRecord = {
	clientId: string;
	agentId: string;
	createdAt: number;
	updatedAt: number;
};

export type RelayQueuedEnvelopeMetadata = {
	id: number;
	messageType: RelayMessageType;
	fromId: string;
	fromType: RelayPrincipalType;
	targetId: string;
	targetType: RelayPrincipalType;
	action: RelayAllowedAction;
	createdAt: number;
};

export type RelayInboundEnvelope<TPayload = Record<string, unknown>> = {
	type: RelayMessageType;
	to: RelayPrincipalType;
	targetId: string;
	action: RelayAllowedAction;
	payload: TPayload;
};

export type RelayOutboundEnvelope<TPayload = Record<string, unknown>> = RelayInboundEnvelope<TPayload> & {
	fromId: string;
	fromType: RelayPrincipalType;
};

export type RelayClientBootstrapRequest = {
	clientId: string;
};

export type RelayClientBootstrapResponse = {
	clientId: string;
	agentId: string;
	token: string;
	expiresAt: number;
	websocketUrl: string;
};

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

export function isRelayPrincipalType(value: unknown): value is RelayPrincipalType {
	return typeof value === "string" && RELAY_PRINCIPAL_TYPES.includes(value as RelayPrincipalType);
}

export function isRelayAllowedAction(value: unknown): value is RelayAllowedAction {
	return typeof value === "string" && RELAY_ALLOWED_ACTIONS.includes(value as RelayAllowedAction);
}

export function isRelayMessageType(value: unknown): value is RelayMessageType {
	return typeof value === "string" && RELAY_MESSAGE_TYPES.includes(value as RelayMessageType);
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