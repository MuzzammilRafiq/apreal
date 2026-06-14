import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const DEV_SERVER_TARGET = "http://localhost:3000";

export default defineConfig(({ mode }) => {
	const target = mode === "remote" ? "remote" : "local";

	return {
		plugins: [
			react(),
			tailwindcss(),
			VitePWA({
				registerType: "autoUpdate",
				includeAssets: ["favicon.svg", "apple-touch-icon.png"],
				manifest: {
					name: "Apreal",
					short_name: "Apreal",
					description: "Apreal local and remote agent interface.",
					theme_color: "#ffffff",
					background_color: "#ffffff",
					display: "standalone",
					orientation: "portrait-primary",
					scope: "/",
					start_url: "/",
					icons: [
						{
							src: "/pwa-192x192.png",
							sizes: "192x192",
							type: "image/png",
							purpose: "any maskable",
						},
						{
							src: "/pwa-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "any maskable",
						},
					],
				},
				workbox: {
					globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
					navigateFallback: "/index.html",
				},
			}),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
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
