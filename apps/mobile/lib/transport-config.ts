import {
  RELAY_BOOTSTRAP_PATH,
  type RelayPairingStateMessage,
  RELAY_SESSION_ACTION,
} from "@/lib/relay";
import type { ClientMessage, ServerMessage } from "@/types/chat";

export const DEFAULT_RELAY_WEBSOCKET_URL =
  "wss://api.malikmuzzammilrafiq.store/ws";
export const DEFAULT_RELAY_BOOTSTRAP_URL =
  `https://api.malikmuzzammilrafiq.store${RELAY_BOOTSTRAP_PATH}`;

export type StoredTransportSettings = {
  relayWebSocketUrl: string;
  relayBootstrapUrl: string;
};

export type RelayTransportConfig = {
  label: string;
  websocketUrl: string;
  bootstrapUrl: string;
};

export const DEFAULT_TRANSPORT_SETTINGS: StoredTransportSettings = {
  relayWebSocketUrl: DEFAULT_RELAY_WEBSOCKET_URL,
  relayBootstrapUrl: DEFAULT_RELAY_BOOTSTRAP_URL,
};

type RelayEnvelope<TPayload> = {
  type: "command" | "response";
  action: string;
  payload: TPayload;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasProtocol(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function normalizePathname(pathname: string, fallbackPath: string) {
  if (!pathname || pathname === "/") {
    return fallbackPath;
  }

  return pathname;
}

export function normalizeWebSocketUrl(value: string, fallbackPath = "/ws") {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error("Enter a relay WebSocket URL first.");
  }

  const candidate = hasProtocol(trimmedValue)
    ? trimmedValue
    : `ws://${trimmedValue}`;
  const url = new URL(candidate);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Relay WebSocket URL must use ws, wss, http, or https.");
  }

  url.pathname = normalizePathname(url.pathname, fallbackPath);
  return url.toString();
}

export function normalizeBootstrapUrl(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error("Enter a relay bootstrap URL first.");
  }

  const candidate = hasProtocol(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;
  const url = new URL(candidate);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  }

  if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bootstrap URL must use http, https, ws, or wss.");
  }

  if (!url.pathname || url.pathname === "/") {
    url.pathname = RELAY_BOOTSTRAP_PATH;
  }

  return url.toString();
}

export function normalizeStoredTransportSettings(
  value: Partial<StoredTransportSettings> | null | undefined,
): StoredTransportSettings {
  return {
    relayWebSocketUrl: normalizeWebSocketUrl(
      value?.relayWebSocketUrl ?? DEFAULT_RELAY_WEBSOCKET_URL,
    ),
    relayBootstrapUrl: normalizeBootstrapUrl(
      value?.relayBootstrapUrl ?? DEFAULT_RELAY_BOOTSTRAP_URL,
    ),
  };
}

export function getRelayTransportConfig(
  settings: StoredTransportSettings,
): RelayTransportConfig {
  return {
    label: "relay",
    websocketUrl: settings.relayWebSocketUrl,
    bootstrapUrl: settings.relayBootstrapUrl,
  };
}

export function createWirePayload(message: ClientMessage) {
  const envelope: RelayEnvelope<ClientMessage> = {
    type: "command",
    action: RELAY_SESSION_ACTION,
    payload: message,
  };

  return JSON.stringify(envelope);
}

export function parseIncomingServerMessage(rawData: unknown): ServerMessage | null {
  if (typeof rawData !== "string") {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!isObjectRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (
    value.type === "pairing_state" &&
    (value.status === "pending" || value.status === "paired") &&
    typeof value.clientId === "string"
  ) {
    return value as RelayPairingStateMessage;
  }

  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message };
  }

  if (value.action !== RELAY_SESSION_ACTION || !isObjectRecord(value.payload)) {
    return null;
  }

  return value.payload as ServerMessage;
}
