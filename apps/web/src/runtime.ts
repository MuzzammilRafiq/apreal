import {
	ADMIN_STATUS_PATH,
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	LOCAL_CLIENT_ID_HEADER,
	LOCAL_CLIENT_ID_QUERY_PARAM,
	SYNC_LAST_SEQ_QUERY_PARAM,
	type LocalWebAdminStatus,
	type RemoteSettingsSection,
} from "@apreal/shared";
import { authBaseUrl } from "./auth/auth-client";
import { ensureLocalBrowserAuthSession } from "./local-auth";
import { readOrCreateLocalClientId } from "./local-client";
import { ensureRelayClientAuth, readRelayClientHeartbeat } from "./relay-auth";
import { readLocalAdminStatus } from "./server-admin";
import { isObjectRecord, type AppRoute, type ClientMessage } from "./app-state";

export type WebCapabilities = {
	settings: boolean;
	jobs: boolean;
	providers: boolean;
	mcpServers: boolean;
	systemPrompt: boolean;
	inventory: boolean;
	settingsSections: SettingsSectionId[];
};

export type SettingsSectionId = RemoteSettingsSection;

export type WebTransportStatus = {
	serverReady: boolean;
	transportReady: boolean;
	adminStatus: LocalWebAdminStatus | null;
	message: string | null;
	settingsSections: SettingsSectionId[];
};

export type WebClientTransport = {
	label: string;
	unavailableTitle: string;
	unavailableBody: string;
	connectingBody: string;
	readStatus: () => Promise<WebTransportStatus>;
	openEventStream: (options?: { lastSeq?: number }) => Promise<WebEventStream>;
	sendMessage: (message: ClientMessage) => Promise<void>;
};

export type WebEventStream = {
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent<string>) => void) | null;
	onerror: ((event: Event) => void) | null;
	close(): void;
};

export type WebRuntime = {
	target: "local" | "remote";
	capabilities: WebCapabilities;
	transport: WebClientTransport;
};

const localCapabilities: WebCapabilities = {
	settings: true,
	jobs: true,
	providers: true,
	mcpServers: true,
	systemPrompt: true,
	inventory: true,
	settingsSections: ["account", "models", "skills", "mcp", "tools", "jobs"],
};

const remoteCapabilities: WebCapabilities = {
	settings: true,
	jobs: true,
	providers: true,
	mcpServers: true,
	systemPrompt: true,
	inventory: true,
	settingsSections: ["account", "models", "skills", "mcp", "tools", "jobs"],
};

function resolveSameOriginBaseUrl(): URL {
	return new URL("/", window.location.origin);
}

function resolveRelayBaseUrl(): URL {
	return new URL("/", authBaseUrl);
}

function createWebSocketUrl(url: string): string {
	const websocketUrl = new URL(url);
	websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
	return websocketUrl.toString();
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function getResponseMessage(payload: unknown, fallback: string): string {
	if (isObjectRecord(payload) && typeof payload.message === "string") {
		return payload.message;
	}

	return fallback;
}


function isRemoteChatMessage(message: ClientMessage): boolean {
	return message.type === "prompt" ||
		message.type === "abort" ||
		message.type === "delete_session" ||
		message.type === "delete_all_sessions" ||
		message.type === "load_session" ||
		message.type === "load_sessions_page" ||
		message.type === "ping";
}

class RemoteWebSocketEventStream implements WebEventStream {
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	private readonly socket: WebSocket;
	private closedByClient = false;

	constructor(
		url: string,
		private readonly context: { clientId: string; targetId: string | null; lastSeq: number | null },
		private readonly onClose: (stream: RemoteWebSocketEventStream) => void,
	) {
		this.socket = new WebSocket(url);
		this.socket.addEventListener("open", (event) => {
			this.onopen?.(event);
		});
		this.socket.addEventListener("message", (event) => {
			const data = typeof event.data === "string" ? event.data : "";
			this.onmessage?.(new MessageEvent("message", { data }));
		});
		this.socket.addEventListener("error", (event) => {
			this.onerror?.(event);
		});
		this.socket.addEventListener("close", (event) => {
			this.onClose(this);
			if (!this.closedByClient) {
				this.onerror?.(event);
			}
		});
	}

	get isOpen(): boolean {
		return this.socket.readyState === WebSocket.OPEN;
	}

	sendMessage(message: ClientMessage) {
		if (!this.isOpen) {
			throw new Error("browser client stream is not connected");
		}

		const data = JSON.stringify(message);
		this.socket.send(data);
	}

	close() {
		this.closedByClient = true;
		this.onClose(this);
		if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
			this.socket.close(1000, "client_closed");
		}
	}
}

function isRouteSupported(route: AppRoute, capabilities: WebCapabilities): boolean {
	if (route === "settings") {
		return capabilities.settings;
	}

	if (route === "jobs") {
		return capabilities.jobs;
	}

	return true;
}

export function coerceRouteForCapabilities(route: AppRoute, capabilities: WebCapabilities): AppRoute {
	return isRouteSupported(route, capabilities) ? route : "chat";
}

export function createLocalWebRuntime(): WebRuntime {
	const serverBaseUrl = resolveSameOriginBaseUrl();
	const localClientId = readOrCreateLocalClientId();
	const messageUrl = new URL(CLIENT_MESSAGE_PATH, serverBaseUrl).toString();
	const streamUrl = new URL(CLIENT_EVENT_STREAM_PATH, serverBaseUrl).toString();
	const statusUrl = new URL(ADMIN_STATUS_PATH, serverBaseUrl).toString();

	return {
		target: "local",
		capabilities: localCapabilities,
		transport: {
			label: "local-server",
			unavailableTitle: "Waiting for local server",
			unavailableBody: "Start the local server to expose the browser UI and chat API.",
			connectingBody: "Reconnecting to the local server event stream.",
			readStatus: async () => {
				const adminStatus = await readLocalAdminStatus(statusUrl);
				return {
					serverReady: true,
					transportReady: true,
					adminStatus,
					message: null,
					settingsSections: localCapabilities.settingsSections,
				};
			},
			openEventStream: async (options) => {
				await ensureLocalBrowserAuthSession();
				const eventStreamUrl = new URL(streamUrl);
				eventStreamUrl.searchParams.set(LOCAL_CLIENT_ID_QUERY_PARAM, localClientId);
				if (typeof options?.lastSeq === "number") {
					eventStreamUrl.searchParams.set(SYNC_LAST_SEQ_QUERY_PARAM, `${options.lastSeq}`);
				}
				return new EventSource(eventStreamUrl.toString());
			},
			sendMessage: async (message) => {
				await ensureLocalBrowserAuthSession();
				const response = await fetch(messageUrl, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						[LOCAL_CLIENT_ID_HEADER]: localClientId,
					},
					body: JSON.stringify(message),
				});
				if (response.ok) {
					return;
				}

				const payload = await parseJsonResponse(response);
				throw new Error(getResponseMessage(payload, `request failed with status ${response.status}`));
			},
		},
	};
}

export function createRemoteWebRuntime(): WebRuntime {
	const relayBaseUrl = resolveRelayBaseUrl();
	const messageUrl = new URL(CLIENT_MESSAGE_PATH, relayBaseUrl).toString();
	const streamUrl = new URL(CLIENT_EVENT_STREAM_PATH, relayBaseUrl).toString();
	let activeStream: RemoteWebSocketEventStream | null = null;

	const readAuth = () => ensureRelayClientAuth(relayBaseUrl.toString());

	return {
		target: "remote",
		capabilities: remoteCapabilities,
		transport: {
			label: "relay",
			unavailableTitle: "Waiting for relay",
			unavailableBody: "Sign in with the same Google account as your local server to use remote chat.",
			connectingBody: "Reconnecting through the relay.",
			readStatus: async () => {
				const heartbeat = await readRelayClientHeartbeat(relayBaseUrl.toString());
				const paired = Boolean(heartbeat.auth.target);
				return {
					serverReady: heartbeat.serverReady,
					transportReady: heartbeat.transportReady,
					adminStatus: null,
					settingsSections: heartbeat.settingsAuthorization.sections,
					message: paired
						? heartbeat.transportReady
							? null
							: "Your laptop server is linked to this account but not connected to the relay."
						: "Sign in locally and remotely with the same Google account to link your laptop server.",
				};
			},
			openEventStream: async (options) => {
				const auth = await readAuth();
				const eventStreamUrl = new URL(streamUrl);
				eventStreamUrl.searchParams.set("token", auth.token);
				if (typeof options?.lastSeq === "number") {
					eventStreamUrl.searchParams.set(SYNC_LAST_SEQ_QUERY_PARAM, `${options.lastSeq}`);
				}
				activeStream?.close();
				const stream = new RemoteWebSocketEventStream(
					createWebSocketUrl(eventStreamUrl.toString()),
					{
						clientId: auth.clientId,
						targetId: auth.target?.id ?? null,
						lastSeq: options?.lastSeq ?? null,
					},
					(closedStream) => {
						if (activeStream === closedStream) {
							activeStream = null;
						}
					},
				);
				activeStream = stream;
				return stream;
			},
			sendMessage: async (message) => {
				const auth = await readAuth();
				if (isRemoteChatMessage(message)) {
					if (!activeStream?.isOpen) {
						throw new Error("browser client stream is not connected");
					}

					activeStream.sendMessage(message);
					return;
				}

				const response = await fetch(messageUrl, {
					method: "POST",
					headers: {
						authorization: `Bearer ${auth.token}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(message),
				});
				if (response.ok) {
					return;
				}

				const payload = await parseJsonResponse(response);
				throw new Error(getResponseMessage(payload, `relay request failed with status ${response.status}`));
			},
		},
	};
}
