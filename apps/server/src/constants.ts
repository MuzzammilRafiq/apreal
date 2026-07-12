export const APREAL_HOME_DIRECTORY_NAME = ".apreal";

export const APREAL_STATE_FILENAMES = {
	auth: "auth.json",
	appendSystemPrompt: "APPEND_SYSTEM.md",
	mcp: "mcp.json",
	models: "models.json",
	relayAuth: "relay-auth.json",
	sessionsDatabase: "sessions.db",
	settings: "settings.json",
} as const;

export const APREAL_STATE_DIRECTORY_NAMES = {
	agent: "agent",
	logs: "logs",
	run: "run",
	sessions: "sessions",
} as const;

export const CONFIG_FILENAME = "config.toml";
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_LOG_LEVEL = "info";
export const DEFAULT_OPEN_BROWSER = true;

export const DEVELOPMENT_WEB_ORIGINS = [
	"http://localhost:5173",
	"http://127.0.0.1:5173",
	"http://localhost:4173",
	"http://127.0.0.1:4173",
] as const;

export const DEFAULT_SESSION_PAGE_LIMIT = 50;
export const MAX_SESSION_PAGE_LIMIT = 200;
export const RELAY_STREAM_RETRY_MS = 1_000;
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
export const INVENTORY_CACHE_TTL_MS = 10_000;
