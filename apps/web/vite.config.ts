import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEV_SERVER_TARGET = "http://localhost:3000";

export default defineConfig(({ mode }) => {
	const target = mode === "remote" ? "remote" : "local";

	return {
		plugins: [react(), tailwindcss()],
		define: {
			__APREAL_WEB_TARGET__: JSON.stringify(target),
		},
		build: {
			outDir: target === "remote" ? "dist-remote" : "dist",
		},
		server: {
			port: target === "remote" ? 5174 : 5173,
			proxy: {
				"/api": {
					target: DEV_SERVER_TARGET,
					changeOrigin: true,
					secure: false,
				},
			},
		},
		preview: {
			port: target === "remote" ? 4174 : 4173,
		},
	};
});
