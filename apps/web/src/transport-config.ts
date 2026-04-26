export type WebTransportConfig = {
	label: string;
	messageUrl: string;
	streamUrl: string;
};

function resolveServerBaseUrl(): URL {
	const configuredUrl = import.meta.env.VITE_PI_SERVER_URL?.trim();
	if (!configuredUrl) {
		if (import.meta.env.DEV) {
			return new URL("http://localhost:3000");
		}

		return new URL(window.location.href);
	}

	return new URL(configuredUrl, window.location.href);
}

export function getWebTransportConfig(): WebTransportConfig {
	const serverBaseUrl = resolveServerBaseUrl();

	return {
		label: "http-stream",
		messageUrl: new URL("/api/client/message", serverBaseUrl).toString(),
		streamUrl: new URL("/api/client/stream", serverBaseUrl).toString(),
	};
}
