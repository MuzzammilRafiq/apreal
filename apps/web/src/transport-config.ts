import { RELAY_BOOTSTRAP_PATH, RELAY_BROWSER_PROTOCOL } from "@apreal/shared";

export type WebTransportMode = "local" | "relay";

type LocalWebTransportConfig = {
	mode: "local";
	label: string;
	websocketUrl: string;
};

type RelayWebTransportConfig = {
	mode: "relay";
	label: string;
	relayWebSocketUrl: string;
	bootstrapUrl: string;
};

export type WebTransportConfig = LocalWebTransportConfig | RelayWebTransportConfig;

function parseMode(value: string | undefined): WebTransportMode {
	if (value?.trim().toLowerCase() === "relay") {
		return "relay";
	}

	return "local";
}

function resolveServerBaseUrl(): URL {
	const configuredUrl = import.meta.env.VITE_PI_SERVER_URL?.trim();
	if (!configuredUrl) {
		if (import.meta.env.DEV) {
			return new URL("http://localhost:3000");
		}

		return new URL(window.location.href);
	}

	const url = new URL(configuredUrl, window.location.href);
	if (url.protocol === "ws:") {
		url.protocol = "http:";
	}
	if (url.protocol === "wss:") {
		url.protocol = "https:";
	}
	if (url.pathname.endsWith("/ws")) {
		url.pathname = url.pathname.slice(0, -3) || "/";
	}

	return url;
}

function resolveHttpBaseUrl(rawUrl: string): URL {
	const url = new URL(rawUrl, window.location.href);
	if (url.protocol === "ws:") {
		url.protocol = "http:";
	}
	if (url.protocol === "wss:") {
		url.protocol = "https:";
	}
	if (url.pathname.endsWith("/ws")) {
		url.pathname = url.pathname.slice(0, -3) || "/";
	}

	return url;
}

function resolveLocalWebSocketUrl(): string {
	const url = resolveServerBaseUrl();
	if (url.protocol === "http:") {
		url.protocol = "ws:";
	}
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	}
	if (!url.pathname || url.pathname === "/") {
		url.pathname = "/ws";
	} else if (!url.pathname.endsWith("/ws")) {
		url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
	}

	return url.toString();
}

function resolveRelayWebSocketUrl(): string {
	const relayUrl = import.meta.env.VITE_PI_RELAY_URL?.trim();
	if (!relayUrl) {
		throw new Error("VITE_PI_RELAY_URL is required when VITE_PI_CONNECTION_MODE=relay");
	}

	const url = new URL(relayUrl, window.location.href);
	if (url.protocol === "http:") {
		url.protocol = "ws:";
	}
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	}

	return url.toString();
}

function resolveBootstrapUrl(): string {
	const explicitBootstrapUrl = import.meta.env.VITE_PI_BOOTSTRAP_URL?.trim();
	if (explicitBootstrapUrl) {
		return new URL(RELAY_BOOTSTRAP_PATH, resolveHttpBaseUrl(explicitBootstrapUrl)).toString();
	}

	const configuredServerUrl = import.meta.env.VITE_PI_SERVER_URL?.trim();
	if (configuredServerUrl) {
		return new URL(RELAY_BOOTSTRAP_PATH, resolveServerBaseUrl()).toString();
	}

	const relayUrl = import.meta.env.VITE_PI_RELAY_URL?.trim();
	if (!relayUrl) {
		throw new Error(
			"VITE_PI_BOOTSTRAP_URL or VITE_PI_SERVER_URL is required when relay bootstrap is not served from the relay origin",
		);
	}

	return new URL(RELAY_BOOTSTRAP_PATH, resolveHttpBaseUrl(relayUrl)).toString();
}

export function createRelayProtocols(token: string): string[] {
	return [RELAY_BROWSER_PROTOCOL, token];
}

export function getWebTransportConfig(): WebTransportConfig {
	const mode = parseMode(import.meta.env.VITE_PI_CONNECTION_MODE);
	if (mode === "local") {
		return {
			mode,
			label: "local server",
			websocketUrl: resolveLocalWebSocketUrl(),
		};
	}

	return {
		mode,
		label: "relay",
		relayWebSocketUrl: resolveRelayWebSocketUrl(),
		bootstrapUrl: resolveBootstrapUrl(),
	};
}