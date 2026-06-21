// Default HTTP port for the standalone relay process.
export const DEFAULT_PORT = 3001;
// Keeps SSE connections alive through proxies and idle timeouts.
export const RELAY_SSE_HEARTBEAT_INTERVAL_MS = 15_000;
// Once a WebSocket heartbeat is sent, do not let a half-open connection stay
// registered indefinitely waiting for the operating system to notice.
export const RELAY_WEBSOCKET_PONG_TIMEOUT_MS = 10_000;
