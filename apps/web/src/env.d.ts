/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APREAL_AUTH_URL?: string;
	readonly VITE_PI_RELAY_URL?: string;
	readonly VITE_ENABLE_REACT_SCAN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
