const CLIENT_EVENT_STREAM_PATH = "/api/client/stream";
const CLIENT_MESSAGE_PATH = "/api/client/message";
const RELAY_CLIENT_AUTH_PATH = "/api/relay/auth/client";
const RELAY_CLIENT_HEARTBEAT_PATH = "/api/relay/heartbeat";
const DEFAULT_RELAY_URL = "https://api.malikmuzzammilrafiq.store";

export type StoredTransportSettings = {
  relayUrl: string;
};

export type RelayTransportConfig = {
  label: string;
  messageUrl: string;
  streamUrl: string;
  relayUrl: string;
};

type LegacyTransportSettings = Partial<StoredTransportSettings> & {
  localServerUrl?: string;
  relayWebSocketUrl?: string;
  relayBootstrapUrl?: string;
};

export const DEFAULT_TRANSPORT_SETTINGS: StoredTransportSettings = {
  relayUrl: DEFAULT_RELAY_URL,
};

function hasProtocol(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (
    normalizedPathname === "/ws" ||
    normalizedPathname === CLIENT_EVENT_STREAM_PATH ||
    normalizedPathname === CLIENT_MESSAGE_PATH ||
    normalizedPathname === RELAY_CLIENT_AUTH_PATH ||
    normalizedPathname === RELAY_CLIENT_HEARTBEAT_PATH
  ) {
    return "/";
  }

  return normalizedPathname;
}

export function normalizeRelayUrl(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error("Enter a relay URL first.");
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
    throw new Error("Relay URL must use http, https, ws, or wss.");
  }

  url.pathname = normalizePathname(url.pathname);

  return url.toString();
}

export function normalizeStoredTransportSettings(
  value: LegacyTransportSettings | null | undefined,
): StoredTransportSettings {
  const relayUrl =
    value?.relayUrl ??
    value?.relayBootstrapUrl ??
    value?.relayWebSocketUrl ??
    value?.localServerUrl ??
    DEFAULT_RELAY_URL;

  return {
    relayUrl: normalizeRelayUrl(relayUrl),
  };
}

export function getRelayTransportConfig(
  settings: StoredTransportSettings,
): RelayTransportConfig {
  const relayBaseUrl = new URL(settings.relayUrl);

  return {
    label: "relay-http",
    messageUrl: new URL(CLIENT_MESSAGE_PATH, relayBaseUrl).toString(),
    streamUrl: new URL(CLIENT_EVENT_STREAM_PATH, relayBaseUrl).toString(),
    relayUrl: relayBaseUrl.toString(),
  };
}
