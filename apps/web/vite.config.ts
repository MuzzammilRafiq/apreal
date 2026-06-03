import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEV_SERVER_TARGET = "http://localhost:3000";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: DEV_SERVER_TARGET,
				changeOrigin: true,
				secure: false,
			},
		},
	},
	preview: {
		port: 4173,
	},
});
