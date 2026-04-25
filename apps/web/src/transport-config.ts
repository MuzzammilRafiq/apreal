import { RELAY_BOOTSTRAP_PATH, RELAY_BROWSER_PROTOCOL } from "@apreal/shared";

export type WebTransportConfig = {
	label: string;
	bootstrapUrl: string;
};

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
		throw new Error("VITE_PI_BOOTSTRAP_URL, VITE_PI_SERVER_URL, or VITE_PI_RELAY_URL is required");
	}

	return new URL(RELAY_BOOTSTRAP_PATH, resolveHttpBaseUrl(relayUrl)).toString();
}

export function createRelayProtocols(token: string): string[] {
	return [RELAY_BROWSER_PROTOCOL, token];
}

export function getWebTransportConfig(): WebTransportConfig {
	return {
		label: "relay",
		bootstrapUrl: resolveBootstrapUrl(),
	};
}
