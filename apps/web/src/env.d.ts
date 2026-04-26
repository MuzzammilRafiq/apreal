/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_PI_SERVER_URL?: string;
	readonly VITE_ENABLE_REACT_SCAN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
