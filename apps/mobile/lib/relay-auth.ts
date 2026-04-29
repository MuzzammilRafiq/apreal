import AsyncStorage from "@react-native-async-storage/async-storage";

const RELAY_CLIENT_AUTH_STORAGE_KEY = "pi-mobile-relay-auth";
const RELAY_CLIENT_AUTH_PATH = "/api/relay/auth/client";
const RELAY_CLIENT_HEARTBEAT_PATH = "/api/relay/heartbeat";

type RelayPrincipalType = "agent" | "client";

type RelayAuthTarget = {
  id: string;
  type: RelayPrincipalType;
};

type RelayClientAuthRequest = {
  clientId: string;
  clientKey: string;
};

type RelayClientAuthResponse = {
  clientId: string;
  clientKey: string;
  token: string;
  expiresAt: number;
  pairingCode: string | null;
  target: RelayAuthTarget | null;
  paired: boolean;
};

type RelayClientHeartbeatResponse = RelayClientAuthResponse & {
  serverReady: boolean;
  transportReady: boolean;
};

export type RelayPairingStateMessage = {
  type: "pairing_state";
  status: "pending" | "paired";
  clientId: string;
  pairingCode: string | null;
  agentId: string | null;
  expiresAt: number | null;
};

export type StoredRelayClientAuth = {
  relayUrl: string;
  clientId: string;
  clientKey: string;
  token: string;
  expiresAt: number;
  pairingCode: string | null;
  target: RelayAuthTarget | null;
  updatedAt: number;
};

export type RelayClientHeartbeatStatus = {
  auth: StoredRelayClientAuth;
  serverReady: boolean;
  transportReady: boolean;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createLocalId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function parseStoredTarget(value: unknown): RelayAuthTarget | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (typeof value.id !== "string") {
    return null;
  }

  if (value.type !== "agent" && value.type !== "client") {
    return null;
  }

  return {
    id: value.id,
    type: value.type,
  };
}

export async function readStoredRelayClientAuth(
  relayUrl: string,
): Promise<StoredRelayClientAuth | null> {
  try {
    const rawValue = await AsyncStorage.getItem(RELAY_CLIENT_AUTH_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!isObjectRecord(parsed)) {
      return null;
    }

    const clientId =
      typeof parsed.clientId === "string" ? parsed.clientId.trim() : "";
    const clientKey =
      typeof parsed.clientKey === "string" ? parsed.clientKey.trim() : "";
    if (!clientId || !clientKey) {
      return null;
    }

    return {
      relayUrl:
        typeof parsed.relayUrl === "string" && parsed.relayUrl.trim()
          ? parsed.relayUrl.trim()
          : relayUrl,
      clientId,
      clientKey,
      token: typeof parsed.token === "string" ? parsed.token : "",
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
      pairingCode:
        typeof parsed.pairingCode === "string" && parsed.pairingCode.trim()
          ? parsed.pairingCode
          : null,
      target: parseStoredTarget(parsed.target),
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function writeStoredRelayClientAuth(auth: StoredRelayClientAuth) {
  await AsyncStorage.setItem(
    RELAY_CLIENT_AUTH_STORAGE_KEY,
    JSON.stringify(auth),
  );
}

async function createClientIdentity(
  relayUrl: string,
): Promise<StoredRelayClientAuth> {
  const existing = await readStoredRelayClientAuth(relayUrl);

  return {
    relayUrl,
    clientId: existing?.clientId ?? `client-${createLocalId("relay-client")}`,
    clientKey: existing?.clientKey ?? `key-${createLocalId("relay-key")}`,
    token: existing?.token ?? "",
    expiresAt: existing?.expiresAt ?? 0,
    pairingCode: existing?.pairingCode ?? null,
    target: existing?.target ?? null,
    updatedAt: Date.now(),
  };
}

function parseClientAuthResponse(payload: unknown): RelayClientAuthResponse {
  if (!isObjectRecord(payload)) {
    throw new Error("relay client auth returned an invalid response");
  }

  const target = payload.target === null ? null : parseStoredTarget(payload.target);
  if (
    typeof payload.clientId !== "string" ||
    typeof payload.clientKey !== "string" ||
    typeof payload.token !== "string" ||
    typeof payload.expiresAt !== "number" ||
    (payload.pairingCode !== null && typeof payload.pairingCode !== "string") ||
    typeof payload.paired !== "boolean" ||
    (payload.target !== null && !target)
  ) {
    throw new Error("relay client auth returned an invalid response");
  }

  return {
    clientId: payload.clientId,
    clientKey: payload.clientKey,
    token: payload.token,
    expiresAt: payload.expiresAt,
    pairingCode: payload.pairingCode,
    target,
    paired: payload.paired,
  };
}

function parseClientHeartbeatResponse(
  payload: unknown,
): RelayClientHeartbeatResponse {
  if (!isObjectRecord(payload)) {
    throw new Error("relay heartbeat returned an invalid response");
  }

  const authResponse = parseClientAuthResponse(payload);
  if (
    typeof payload.serverReady !== "boolean" ||
    typeof payload.transportReady !== "boolean"
  ) {
    throw new Error("relay heartbeat returned an invalid response");
  }

  return {
    ...authResponse,
    serverReady: payload.serverReady,
    transportReady: payload.transportReady,
  };
}

export async function ensureRelayClientAuth(
  relayUrl: string,
): Promise<StoredRelayClientAuth> {
  const identity = await createClientIdentity(relayUrl);
  await writeStoredRelayClientAuth(identity);

  const requestBody: RelayClientAuthRequest = {
    clientId: identity.clientId,
    clientKey: identity.clientKey,
  };

  const response = await fetch(new URL(RELAY_CLIENT_AUTH_PATH, relayUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore malformed bodies and use the status fallback below.
  }

  if (!response.ok) {
    const message =
      isObjectRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `relay client auth failed with status ${response.status}`;
    throw new Error(message);
  }

  const issuedAuth = parseClientAuthResponse(payload);
  const nextAuth: StoredRelayClientAuth = {
    relayUrl,
    clientId: issuedAuth.clientId,
    clientKey: issuedAuth.clientKey,
    token: issuedAuth.token,
    expiresAt: issuedAuth.expiresAt,
    pairingCode: issuedAuth.pairingCode,
    target: issuedAuth.target,
    updatedAt: Date.now(),
  };
  await writeStoredRelayClientAuth(nextAuth);
  return nextAuth;
}

export async function readRelayClientHeartbeat(
  relayUrl: string,
): Promise<RelayClientHeartbeatStatus> {
  const identity = await createClientIdentity(relayUrl);
  await writeStoredRelayClientAuth(identity);

  const requestBody: RelayClientAuthRequest = {
    clientId: identity.clientId,
    clientKey: identity.clientKey,
  };

  const response = await fetch(new URL(RELAY_CLIENT_HEARTBEAT_PATH, relayUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore malformed bodies and use the status fallback below.
  }

  if (!response.ok) {
    const message =
      isObjectRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `relay heartbeat failed with status ${response.status}`;
    throw new Error(message);
  }

  const heartbeat = parseClientHeartbeatResponse(payload);
  const nextAuth: StoredRelayClientAuth = {
    relayUrl,
    clientId: heartbeat.clientId,
    clientKey: heartbeat.clientKey,
    token: heartbeat.token,
    expiresAt: heartbeat.expiresAt,
    pairingCode: heartbeat.pairingCode,
    target: heartbeat.target,
    updatedAt: Date.now(),
  };
  await writeStoredRelayClientAuth(nextAuth);
  return {
    auth: nextAuth,
    serverReady: heartbeat.serverReady,
    transportReady: heartbeat.transportReady,
  };
}