import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, type RawData } from "ws";
import {
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	type RelayAgentCommand,
} from "@apreal/shared";
import {
	ensureRelayAgentAuth,
	authenticateRelayAgentWithOwnerGrant,
	getRelayServerUrl,
	readClientTokenFromRequest,
	verifyRelayClientAccess,
} from "../relay-auth.ts";
import { parseClientAppMessage, type ClientAppMessage } from "../protocol.ts";
import {
	isObjectRecord,
	parseRelayAgentCommand,
	RELAY_STREAM_RETRY_MS,
	type ServerMessage,
} from "./utils.ts";
import { getErrorMessage } from "../session.ts";
import type { ClientActions, Logger } from "./client-manager.ts";

export interface RelayMutableState {
	auth: Awaited<ReturnType<typeof ensureRelayAgentAuth>> | null;
	startupError: string | null;
	transportConnected: boolean;
	transportGeneration: number;
	transportAbortController: AbortController | null;
	authenticating: boolean;
}

export interface RelayState {
	logger: Logger;
	relayUrl: string;
	relayState: RelayMutableState;
	clients: Map<string, import("./utils.ts").ClientConnection>;
}

export interface RelayActions {
	getClientAuthErrorStatus(error: unknown): number;
	authenticateClientRequest(request: Request): Promise<{ clientId: string }>;
	restartRelayTransport(): void;
	authenticateWithOwnerGrant(ownerGrant: string): Promise<Awaited<ReturnType<typeof ensureRelayAgentAuth>>>;
	isConfigured(): boolean;
}

const RELAY_AGENT_AUTH_REFRESH_WINDOW_MS = 60 * 1000;

export function createRelay(
	state: RelayState,
	clientActions: ClientActions,
	handleClientMessage: (clientId: string, message: ClientAppMessage) => Promise<void>,
): RelayActions {
	const { logger, relayUrl, relayState, clients } = state;
	const { removeClientConnection, registerClientConnection, sendError, sendConnected } = clientActions;
	let relayAuthRefreshPromise: Promise<Awaited<ReturnType<typeof ensureRelayAgentAuth>>> | null = null;
	let relayAgentWebSocket: WebSocket | null = null;

	function getClientAuthErrorStatus(error: unknown): number {
		const message = getErrorMessage(error);
		return message === relayState.startupError ? 503 : 401;
	}

	async function authenticateClientRequest(request: Request): Promise<{ clientId: string }> {
		if (!relayState.auth) {
			throw new Error(relayState.startupError ?? "Relay registration is not ready.");
		}

		const clientToken = readClientTokenFromRequest(request);
		if (!clientToken) {
			throw new Error("Missing client auth token.");
		}

		return verifyRelayClientAccess(relayUrl, clientToken, relayState.auth.agentId);
	}

	function relayAuthNeedsRefresh(auth: Awaited<ReturnType<typeof ensureRelayAgentAuth>> | null): boolean {
		return !auth?.token || !auth.expiresAt || auth.expiresAt - Date.now() <= RELAY_AGENT_AUTH_REFRESH_WINDOW_MS;
	}

	async function ensureActiveRelayAgentAuth(options?: { force?: boolean }) {
		if (!options?.force && !relayAuthNeedsRefresh(relayState.auth)) {
			return relayState.auth as Awaited<ReturnType<typeof ensureRelayAgentAuth>>;
		}

		if (relayAuthRefreshPromise) {
			return relayAuthRefreshPromise;
		}

		relayAuthRefreshPromise = ensureRelayAgentAuth(logger, relayUrl)
			.then((auth) => {
				relayState.auth = auth;
				relayState.startupError = null;
				return auth;
			})
			.finally(() => {
				relayAuthRefreshPromise = null;
			});

		return relayAuthRefreshPromise;
	}

	function resetClientConnections(reason: string) {
		for (const clientId of Array.from(clients.keys())) {
			removeClientConnection(clientId, reason);
		}
	}

	function resetRelayClientConnections(reason: string) {
		for (const [clientId, client] of Array.from(clients.entries())) {
			if (client.transport === "relay") {
				removeClientConnection(clientId, reason);
			}
		}
	}

	function setRelayTransportDisconnected(reason: string) {
		relayState.transportConnected = false;
		resetRelayClientConnections(reason);
	}

	async function sendRelayServerMessage(token: string, clientId: string, payload: ServerMessage) {
		const activeWebSocket = relayAgentWebSocket;
		if (activeWebSocket?.readyState === WebSocket.OPEN) {
			try {
				await sendRelayServerMessageOverWebSocket(activeWebSocket, clientId, payload);
				return;
			} catch (error) {
				logger.warn("relay websocket send failed; falling back to http post", {
					clientId,
					payloadType: payload.type === "sync_event" ? payload.payload.type : payload.type,
					seq: payload.type === "sync_event" ? payload.seq : undefined,
					error: getErrorMessage(error),
				});
			}
		}

		const response = await fetch(new URL(RELAY_AGENT_MESSAGE_PATH, relayUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				type: "server_message",
				clientId,
				message: payload,
			}),
		});

		if (response.ok) {
			return;
		}

		let message = `relay agent message failed with status ${response.status}`;
		try {
			const body: unknown = await response.json();
			if (isObjectRecord(body) && typeof body.message === "string") {
				message = body.message;
			}
		} catch {
			// Ignore malformed bodies and use the status fallback above.
		}

		const error = new Error(message);
		if (response.status === 401) {
			(error as Error & { status?: number }).status = 401;
		}
		throw error;
	}

	function createRelayWebSocketUrl(pathname: string): string {
		const url = new URL(pathname, relayUrl);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.toString();
	}

	function getWebSocketMessageText(data: RawData): string {
		if (typeof data === "string") {
			return data;
		}

		if (Buffer.isBuffer(data)) {
			return data.toString("utf8");
		}

		if (Array.isArray(data)) {
			return Buffer.concat(data).toString("utf8");
		}

		return Buffer.from(data).toString("utf8");
	}

	function sendRelayServerMessageOverWebSocket(ws: WebSocket, clientId: string, payload: ServerMessage): Promise<void> {
		const message = {
			type: "server_message",
			clientId,
			message: payload,
		};
		const data = JSON.stringify(message);
		return new Promise((resolve, reject) => {
			ws.send(data, (error) => {
				if (error) {
					logger.warn("relay websocket server message send failed", {
						clientId,
						error: getErrorMessage(error),
					});
					reject(error);
					return;
				}

				resolve();
			});
		});
	}

	async function postRelayServerMessage(clientId: string, payload: ServerMessage) {
		const currentAuth = await ensureActiveRelayAgentAuth();
		try {
			await sendRelayServerMessage(currentAuth.token as string, clientId, payload);
		} catch (error) {
			if ((error as { status?: number }).status !== 401) {
				logger.warn("posting relay server message failed", {
					clientId,
					payloadType: payload.type === "sync_event" ? payload.payload.type : payload.type,
					error: getErrorMessage(error),
				});
				throw error;
			}

			logger.warn("posting relay server message got 401; refreshing auth", {
				clientId,
				payloadType: payload.type === "sync_event" ? payload.payload.type : payload.type,
			});
			const refreshedAuth = await ensureActiveRelayAgentAuth({ force: true });
			await sendRelayServerMessage(refreshedAuth.token as string, clientId, payload);
		}
	}

	function createRelaySendPayload(clientId: string): import("./utils.ts").ClientConnection["send"] {
		return (payload) => {
			void postRelayServerMessage(clientId, payload).catch((error) => {
				logger.warn("failed to deliver relay client payload", {
					clientId,
					error: getErrorMessage(error),
				});
				removeClientConnection(clientId, "relay_delivery_failed");
			});
			return true;
		};
	}

	function ensureRelayClientConnection(clientId: string, options: { lastSeq?: number; announce?: boolean } = {}) {
		const existing = clients.get(clientId);
		if (existing?.transport === "relay" && !existing.closed) {
			existing.ready = true;
			clientActions.replayClientSyncEvents(clientId, options.lastSeq);
			if (options.announce) {
				sendConnected(clientId);
			}
			return existing;
		}

		const wasReady = existing?.ready ?? false;
		const client = registerClientConnection(clientId, "relay", createRelaySendPayload(clientId));
		client.ready = true;
		clientActions.replayClientSyncEvents(clientId, options.lastSeq);
		if (options.announce || !wasReady) {
			sendConnected(clientId);
		}
		return client;
	}

	async function handleRelayAgentCommand(command: RelayAgentCommand) {
		switch (command.type) {
			case "client_connect": {
				ensureRelayClientConnection(command.clientId, { lastSeq: command.lastSeq, announce: true });
				break;
			}
			case "client_disconnect": {
				removeClientConnection(command.clientId, command.reason ?? "relay_client_disconnected");
				break;
			}
			case "client_message": {
				ensureRelayClientConnection(command.clientId);
				const message = parseClientAppMessage(command.message);
				if (!message) {
					sendError(command.clientId, "Invalid client message payload.");
					return;
				}

				await handleClientMessage(command.clientId, message);
				break;
			}
		}
	}

	async function consumeRelayAgentStream(token: string, signal: AbortSignal) {
		const response = await fetch(new URL(RELAY_AGENT_STREAM_PATH, relayUrl), {
			method: "GET",
			headers: {
				authorization: `Bearer ${token}`,
				accept: "text/event-stream",
			},
			signal,
		});

		if (!response.ok || !response.body) {
			let message = `relay agent stream failed with status ${response.status}`;
			try {
				const body = await response.text();
				if (body.trim()) {
					message = body.trim();
				}
			} catch {
				// Ignore malformed bodies and use the status fallback above.
			}

			throw new Error(message);
		}

		relayState.transportConnected = true;
		logger.info("relay agent stream response opened", {
			relayUrl,
		});
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const result = await reader.read();
				if (result.done) {
					break;
				}

				buffer += decoder.decode(result.value, { stream: true });
				let boundaryIndex = buffer.search(/\r?\n\r?\n/);
				while (boundaryIndex !== -1) {
					const rawEvent = buffer.slice(0, boundaryIndex);
					const separatorLength = buffer[boundaryIndex] === "\r" ? 4 : 2;
					buffer = buffer.slice(boundaryIndex + separatorLength);

					const data = rawEvent
						.split(/\r?\n/)
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");

					if (data) {
						const command = parseRelayAgentCommand(data);
						if (command) {
							await handleRelayAgentCommand(command);
						} else {
							logger.warn("ignored invalid relay agent command", { raw: data });
						}
					}

					boundaryIndex = buffer.search(/\r?\n\r?\n/);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async function consumeRelayAgentWebSocket(token: string, signal: AbortSignal) {
		const url = createRelayWebSocketUrl(RELAY_AGENT_STREAM_PATH);
		const ws = new WebSocket(url, {
			headers: {
				authorization: `Bearer ${token}`,
			},
		});
		relayAgentWebSocket = ws;
		let commandChain = Promise.resolve();
		let opened = false;

		const closeForAbort = () => {
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.close(1000, "relay_transport_aborted");
			}
		};
		signal.addEventListener("abort", closeForAbort, { once: true });

		try {
			await new Promise<void>((resolve, reject) => {
				const handleOpen = () => {
					ws.off("error", handleOpenError);
					ws.off("close", handleOpenClose);
					opened = true;
					relayState.transportConnected = true;
					logger.info("relay agent websocket opened", {
						relayUrl,
						bufferedAmount: ws.bufferedAmount,
					});
					resolve();
				};
				const handleOpenError = (error: Error) => {
					ws.off("open", handleOpen);
					ws.off("close", handleOpenClose);
					reject(error);
				};
				const handleOpenClose = (code: number, reason: Buffer) => {
					ws.off("open", handleOpen);
					ws.off("error", handleOpenError);
					reject(new Error(`relay agent websocket closed before open (${code}: ${reason.toString()})`));
				};
				ws.once("open", handleOpen);
				ws.once("error", handleOpenError);
				ws.once("close", handleOpenClose);
			});

			await new Promise<void>((resolve, reject) => {
				ws.on("message", (data) => {
					const rawMessage = getWebSocketMessageText(data);
					commandChain = commandChain
						.then(async () => {
							const command = parseRelayAgentCommand(rawMessage);
							if (command) {
								await handleRelayAgentCommand(command);
							} else {
								logger.warn("ignored invalid relay agent websocket command", { raw: rawMessage });
							}
						})
						.catch((error) => {
							logger.warn("relay agent websocket command handler failed", {
								error: getErrorMessage(error),
							});
						});
				});
				ws.once("close", (code, reason) => {
					logger.warn("relay agent websocket closed", {
						relayUrl,
						code,
						reason: reason.toString(),
					});
					resolve();
				});
				ws.once("error", (error) => {
					logger.warn("relay agent websocket error", {
						relayUrl,
						error: getErrorMessage(error),
					});
					reject(error);
				});
			});
		} finally {
			signal.removeEventListener("abort", closeForAbort);
			if (relayAgentWebSocket === ws) {
				relayAgentWebSocket = null;
			}
			await commandChain.catch(() => {
				// Command handler errors are logged above.
			});
		}
	}

	async function runRelayTransportLoop(generation: number) {
		while (generation === relayState.transportGeneration) {
			let currentAuth: Awaited<ReturnType<typeof ensureRelayAgentAuth>>;
			try {
				currentAuth = await ensureActiveRelayAgentAuth();
			} catch (error) {
				relayState.startupError = getErrorMessage(error);
				setRelayTransportDisconnected("relay_transport_unavailable");
				logger.warn("relay agent transport authentication failed", {
					relayUrl,
					error: relayState.startupError,
				});
				return;
			}

			const abortController = new AbortController();
			relayState.transportAbortController = abortController;

			try {
				await consumeRelayAgentWebSocket(currentAuth.token as string, abortController.signal);
				if (abortController.signal.aborted || generation !== relayState.transportGeneration) {
					return;
				}

				logger.warn("relay agent websocket ended; reconnecting", {
					relayUrl,
					agentId: currentAuth.agentId,
				});
			} catch (error) {
				if (abortController.signal.aborted || generation !== relayState.transportGeneration) {
					return;
				}

				logger.warn("relay agent websocket disconnected", {
					relayUrl,
					agentId: currentAuth.agentId,
					error: getErrorMessage(error),
				});
			} finally {
				if (relayState.transportAbortController === abortController) {
					relayState.transportAbortController = null;
				}
				setRelayTransportDisconnected("relay_transport_disconnected");
			}

			if (generation !== relayState.transportGeneration) {
				return;
			}

			await delay(RELAY_STREAM_RETRY_MS);
		}
	}

	function restartRelayTransport() {
		relayState.transportGeneration += 1;
		relayState.transportAbortController?.abort();
		setRelayTransportDisconnected("relay_transport_restarting");

		if (!relayState.auth?.token) {
			return;
		}

		void runRelayTransportLoop(relayState.transportGeneration);
	}

	async function authenticateWithOwnerGrant(ownerGrant: string) {
		if (relayState.authenticating) {
			throw new Error("Relay authentication already in progress.");
		}

		relayState.authenticating = true;
		try {
			relayState.auth = await authenticateRelayAgentWithOwnerGrant(logger, ownerGrant, relayUrl);
			relayState.startupError = null;
			resetClientConnections("relay_owner_authenticated");
			restartRelayTransport();
			logger.info("relay owner authentication completed", {
				agentId: relayState.auth.agentId,
			});
			return relayState.auth;
		} finally {
			relayState.authenticating = false;
		}
	}

	return {
		getClientAuthErrorStatus,
		authenticateClientRequest,
		restartRelayTransport,
		authenticateWithOwnerGrant,
		isConfigured: () => Boolean(relayState.auth),
	};
}
