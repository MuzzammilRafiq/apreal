import WebSocket, { WebSocketServer, type RawData } from "ws";
import { AuthError, authenticateRequest, type AuthTokenPayload, type UserType } from "./auth.ts";

// The relay defaults to a different port from the laptop-side app server to
// avoid local development conflicts.
const DEFAULT_PORT = 3001;

// The relay is intentionally narrow: it brokers only a small, reviewable set
// of actions and does not execute them itself. Expanding this list should be a
// conscious security decision.
const ALLOWED_ACTIONS = ["ping", "read_file"] as const;

type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

// Messages flowing through the relay are intentionally simple.
// `command` is client -> agent, while `response` is agent -> client.
type RelayMessageType = "command" | "response";

// This is the only inbound message shape the relay accepts from connected
// peers. There is no registration frame because identity comes from the JWT,
// not from user-controlled message content.
type RelayInboundMessage = {
  type: RelayMessageType;
  to: UserType;
  targetId: string;
  action: AllowedAction;
  payload: Record<string, unknown>;
};

// Forwarded messages are stamped with authenticated sender metadata derived by
// the relay. This blocks impersonation because peers cannot choose `fromId`
// values for themselves.
type RelayOutboundMessage = RelayInboundMessage & {
  fromId: string;
  fromType: UserType;
};

// The `ws` library allows attaching custom properties at runtime. We store the
// verified token payload on the socket so later handlers can make auth-aware
// routing decisions without reparsing the token.
type RelaySocket = WebSocket & {
  user?: AuthTokenPayload;
};

type LogLevel = "info" | "warn" | "error";

const agents = new Map<string, RelaySocket>();
const clients = new Map<string, RelaySocket>();

// Reject invalid `PORT` values instead of throwing. Falling back keeps local
// startup predictable while still allowing explicit configuration in prod.
function parsePort(rawPort: string | undefined): number {
  const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
  if (Number.isNaN(candidate) || candidate <= 0) {
    return DEFAULT_PORT;
  }

  return candidate;
}

// Minimal structured logging keeps the relay dependency surface small while
// still making auth failures and routing decisions observable in production.
function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [relay-server] ${message}`;
  const serializedFields = fields ? ` ${JSON.stringify(fields)}` : "";

  if (level === "error") {
    console.error(`${line}${serializedFields}`);
    return;
  }

  if (level === "warn") {
    console.warn(`${line}${serializedFields}`);
    return;
  }

  console.log(`${line}${serializedFields}`);
}

// The action list is validated on every frame so a peer cannot tunnel an
// unapproved operation through the relay by inventing a new action name.
function isAllowedAction(value: unknown): value is AllowedAction {
  return typeof value === "string" && ALLOWED_ACTIONS.includes(value as AllowedAction);
}

// The relay accepts object payloads only. Arrays and primitives are rejected
// because the protocol is defined as a JSON object envelope with an object
// `payload` field.
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `ws` may surface frames as strings, buffers, array buffers, or arrays of
// buffers. Normalizing to UTF-8 text in one place keeps the parser predictable.
function rawMessageToString(rawMessage: RawData): string {
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  if (Array.isArray(rawMessage)) {
    return Buffer.concat(rawMessage).toString("utf8");
  }

  if (rawMessage instanceof ArrayBuffer) {
    return Buffer.from(rawMessage).toString("utf8");
  }

  return rawMessage.toString("utf8");
}

// Parse and validate the user-supplied message envelope defensively.
// Any malformed or incomplete frame is rejected before authorization or
// forwarding happens. This keeps bad inputs from leaking deeper into the relay.
function parseRelayMessage(rawMessage: RawData): RelayInboundMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(rawMessageToString(rawMessage));
  } catch {
    return null;
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  if ((value.type !== "command" && value.type !== "response") || (value.to !== "agent" && value.to !== "client")) {
    return null;
  }

  if (typeof value.targetId !== "string" || value.targetId.trim().length === 0) {
    return null;
  }

  if (!isAllowedAction(value.action)) {
    return null;
  }

  if (!isObjectRecord(value.payload)) {
    return null;
  }

  return {
    type: value.type,
    to: value.to,
    targetId: value.targetId,
    action: value.action,
    payload: value.payload,
  };
}

// Role-specific connection maps are kept separate so authorization decisions
// stay simple and lookups do not depend on any caller-controlled field.
function getRegistry(type: UserType): Map<string, RelaySocket> {
  return type === "agent" ? agents : clients;
}

// Unauthorized peers are always closed with the policy-violation code required
// by the relay contract. This happens during or immediately after connection.
function closeUnauthorized(socket: RelaySocket) {
  try {
    socket.close(1008, "unauthorized");
  } catch (error) {
    log("warn", "failed to close unauthorized socket", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Invalid runtime behavior should not crash the relay or leave callers guessing.
// A small error frame gives the authenticated sender feedback when their route
// or payload is rejected.
function sendError(socket: RelaySocket, code: string, message: string) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: "error", code, message }));
}

// Registration happens from verified token claims only. If a second connection
// arrives with the same authenticated ID, the older one is replaced so the map
// always points to the latest active socket for that principal.
function registerConnection(socket: RelaySocket) {
  const user = socket.user;
  if (!user) {
    closeUnauthorized(socket);
    return;
  }

  const registry = getRegistry(user.type);
  const existingSocket = registry.get(user.id);
  if (existingSocket && existingSocket !== socket && existingSocket.readyState === WebSocket.OPEN) {
    existingSocket.close(1008, "replaced");
  }

  registry.set(user.id, socket);
  log("info", "authenticated relay connection", {
    id: user.id,
    type: user.type,
  });
}

// Cleanup is deterministic because each socket already knows its authenticated
// role and ID. That avoids scanning unrelated maps during close handling.
function cleanupConnection(socket: RelaySocket) {
  const user = socket.user;
  if (!user) {
    return;
  }

  const registry = getRegistry(user.type);
  if (registry.get(user.id) === socket) {
    registry.delete(user.id);
  }

  log("info", "relay connection closed", {
    id: user.id,
    type: user.type,
  });
}

// Authorization is role-based and deliberately strict. The relay does not try
// to infer intent; it only permits the two allowed communication directions.
function isAuthorizedRoute(user: AuthTokenPayload, message: RelayInboundMessage): boolean {
  if (user.type === "client") {
    return message.type === "command" && message.to === "agent";
  }

  if (user.type === "agent") {
    return message.type === "response" && message.to === "client";
  }

  return false;
}

// Forwarding is the heart of the broker. By the time this runs, the socket is
// authenticated and the frame has passed structural validation. This function
// applies the remaining authorization checks and performs the actual delivery.
function forwardMessage(socket: RelaySocket, message: RelayInboundMessage) {
  const user = socket.user;
  if (!user) {
    closeUnauthorized(socket);
    return;
  }

  if (!isAuthorizedRoute(user, message)) {
    log("warn", "rejected unauthorized route", {
      fromId: user.id,
      fromType: user.type,
      messageType: message.type,
      to: message.to,
      targetId: message.targetId,
    });
    sendError(socket, "forbidden", "route not allowed for this role");
    return;
  }

  const target = getRegistry(message.to).get(message.targetId);
  if (!target || target.readyState !== WebSocket.OPEN) {
    log("warn", "target not connected", {
      fromId: user.id,
      fromType: user.type,
      to: message.to,
      targetId: message.targetId,
    });
    sendError(socket, "target_unavailable", "target connection is not available");
    return;
  }

  const outboundMessage: RelayOutboundMessage = {
    type: message.type,
    to: message.to,
    targetId: message.targetId,
    action: message.action,
    payload: message.payload,
    fromId: user.id,
    fromType: user.type,
  };

  try {
    target.send(JSON.stringify(outboundMessage));
  } catch (error) {
    log("error", "failed to forward relay message", {
      fromId: user.id,
      fromType: user.type,
      targetId: message.targetId,
      error: error instanceof Error ? error.message : String(error),
    });
    sendError(socket, "delivery_failed", "failed to forward message");
  }
}

// Message handling is intentionally shallow: parse, reject invalid input, then
// hand off to the authorization-aware forwarder. Keeping the stages separate
// makes auditing and future extension easier.
function handleMessage(socket: RelaySocket, rawMessage: RawData) {
  const message = parseRelayMessage(rawMessage);
  if (!message) {
    const user = socket.user;
    log("warn", "rejected invalid relay message", {
      id: user?.id,
      type: user?.type,
    });
    sendError(socket, "invalid_message", "message must be valid JSON with the relay schema");
    return;
  }

  forwardMessage(socket, message);
}

// The relay authenticates every websocket during connection setup and refuses
// to install message handlers for unauthenticated sockets. That ensures no
// application message is ever processed before auth completes.
export function runRelayServer(options?: { port?: number }) {
  const port = options?.port ?? parsePort(process.env.PORT);
  const wss = new WebSocketServer({ port });

  wss.on("connection", (socket: RelaySocket, request) => {
    try {
      // The verified JWT payload becomes the socket identity for the lifetime
      // of the connection.
      socket.user = authenticateRequest(request);
    } catch (error) {
      const reason = error instanceof AuthError ? error.message : "unknown auth error";
      log("warn", "relay authentication failed", {
        reason,
        remoteAddress: request.socket.remoteAddress,
      });
      closeUnauthorized(socket);
      return;
    }

    registerConnection(socket);

    socket.on("message", (rawMessage) => {
      handleMessage(socket, rawMessage);
    });

    // Socket-level errors are logged for visibility, but they should not bring
    // down the relay process.
    socket.on("error", (error) => {
      log("warn", "relay socket error", {
        id: socket.user?.id,
        type: socket.user?.type,
        error: error.message,
      });
    });

    socket.on("close", () => {
      cleanupConnection(socket);
    });
  });

  // Startup logs include the action allowlist so an operator can confirm the
  // relay is running with the intended policy.
  log("info", "relay server listening", {
    port,
    allowedActions: ALLOWED_ACTIONS,
  });

  return wss;
}

if (import.meta.main) {
  runRelayServer();
}