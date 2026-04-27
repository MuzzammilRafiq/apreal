import { CLIENT_EVENT_STREAM_PATH, CLIENT_MESSAGE_PATH } from "@apreal/shared";

export type WebTransportConfig = {
	label: string;
	messageUrl: string;
	streamUrl: string;
	relayUrl: string;
};

const DEFAULT_API_BASE_URL = "https://api.malikmuzzammilrafiq.store";
const DEV_PROXY_BASE_PATH = "/api/";

function resolveRelayBaseUrl(): URL {
	const configuredUrl = import.meta.env.VITE_PI_RELAY_URL?.trim();
	const relayUrl = configuredUrl ? new URL(configuredUrl, window.location.href) : new URL(DEFAULT_API_BASE_URL);

	if (import.meta.env.DEV && relayUrl.origin !== window.location.origin) {
		return new URL(DEV_PROXY_BASE_PATH, window.location.origin);
	}

	return relayUrl;
}

export function getWebTransportConfig(): WebTransportConfig {
	const relayBaseUrl = resolveRelayBaseUrl();

	return {
		label: "relay-http",
		messageUrl: new URL(CLIENT_MESSAGE_PATH, relayBaseUrl).toString(),
		streamUrl: new URL(CLIENT_EVENT_STREAM_PATH, relayBaseUrl).toString(),
		relayUrl: relayBaseUrl.toString(),
	};
}
