import { CLIENT_EVENT_STREAM_PATH, CLIENT_MESSAGE_PATH } from "@apreal/shared";

export type WebTransportConfig = {
	label: string;
	messageUrl: string;
	streamUrl: string;
	relayUrl: string;
};

const DEFAULT_API_BASE_URL = "https://api.malikmuzzammilrafiq.store";

function resolveRelayBaseUrl(): URL {
	const configuredUrl = import.meta.env.VITE_PI_RELAY_URL?.trim();
	if (!configuredUrl) {
		return new URL(DEFAULT_API_BASE_URL);
	}

	return new URL(configuredUrl, window.location.href);
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
