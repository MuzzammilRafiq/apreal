export const RELAY_BROWSER_PROTOCOL = "relay.jwt";
export const RELAY_BOOTSTRAP_PATH = "/api/relay/bootstrap";
export const RELAY_SESSION_ACTION = "session_message" as const;

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

export type RelayPairingStateMessage = {
  type: "pairing_state";
  status: "pending" | "paired";
  clientId: string;
  pairingCode: string | null;
  agentId: string | null;
  expiresAt: number | null;
};

export type RelayClientBootstrapResponse = {
  clientId: string;
  token: string;
  expiresAt: number;
  websocketUrl: string;
  pairing: RelayPairingStateMessage;
};

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

export function createRelayProtocols(token: string): string[] {
  return [RELAY_BROWSER_PROTOCOL, token];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRelayBootstrapResponse(
  value: unknown,
): value is RelayClientBootstrapResponse {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    isObjectRecord(value.pairing) &&
    (value.pairing.status === "pending" || value.pairing.status === "paired") &&
    typeof value.token === "string" &&
    value.token.trim().length > 0 &&
    typeof value.websocketUrl === "string" &&
    value.websocketUrl.trim().length > 0 &&
    typeof value.expiresAt === "number" &&
    normalizeRelayPrincipalId(value.clientId) !== null
  );
}

export async function fetchRelayBootstrap(
  bootstrapUrl: string,
  clientId: string,
): Promise<RelayClientBootstrapResponse> {
  const response = await fetch(bootstrapUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ clientId }),
  });

  if (!response.ok) {
    throw new Error(`relay bootstrap failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!isRelayBootstrapResponse(data)) {
    throw new Error("relay bootstrap returned an invalid payload");
  }

  return {
    ...data,
    clientId: normalizeRelayPrincipalId(data.clientId)!,
    pairing: {
      ...data.pairing,
      clientId: normalizeRelayPrincipalId(data.pairing.clientId) ?? data.clientId,
      agentId:
        typeof data.pairing.agentId === "string"
          ? normalizeRelayPrincipalId(data.pairing.agentId)
          : null,
    },
  };
}
