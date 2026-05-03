import {
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
} from "@apreal/shared";
import { readOrCreateLocalClientId } from "./local-client";

export type WebTransportConfig = {
	label: string;
	messageUrl: string;
	streamUrl: string;
	statusUrl: string;
	relayReauthenticateUrl: string;
	localClientId: string;
};

function resolveServerBaseUrl(): URL {
	return new URL("/", window.location.origin);
}

export function getWebTransportConfig(): WebTransportConfig {
	const serverBaseUrl = resolveServerBaseUrl();
	const localClientId = readOrCreateLocalClientId();

	return {
		label: "local-server",
		messageUrl: new URL(CLIENT_MESSAGE_PATH, serverBaseUrl).toString(),
		streamUrl: new URL(CLIENT_EVENT_STREAM_PATH, serverBaseUrl).toString(),
		statusUrl: new URL(ADMIN_STATUS_PATH, serverBaseUrl).toString(),
		relayReauthenticateUrl: new URL(ADMIN_RELAY_REAUTHENTICATE_PATH, serverBaseUrl).toString(),
		localClientId,
	};
}
