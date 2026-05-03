import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_SERVER_URL = "http://localhost:3000";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const serverTarget = env.VITE_PI_SERVER_URL?.trim() || DEFAULT_SERVER_URL;

	return {
		plugins: [react(), tailwindcss()],
		server: {
			port: 5173,
			proxy: {
				"/api": {
					target: serverTarget,
					changeOrigin: true,
					secure: false,
				},
			},
		},
		preview: {
			port: 4173,
		},
	};
});