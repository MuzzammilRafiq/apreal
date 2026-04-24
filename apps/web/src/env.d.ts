/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_PI_CONNECTION_MODE?: "local" | "relay";
	readonly VITE_PI_SERVER_URL?: string;
	readonly VITE_PI_BOOTSTRAP_URL?: string;
	readonly VITE_PI_RELAY_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}