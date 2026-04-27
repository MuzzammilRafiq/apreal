import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_RELAY_URL = "https://api.malikmuzzammilrafiq.store";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const relayTarget = env.VITE_PI_RELAY_URL?.trim() || DEFAULT_RELAY_URL;

	return {
		plugins: [react(), tailwindcss()],
		server: {
			port: 5173,
			proxy: {
				"/api": {
					target: relayTarget,
					changeOrigin: true,
					secure: true,
				},
			},
		},
		preview: {
			port: 4173,
		},
	};
});