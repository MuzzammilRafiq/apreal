import { setTimeout as delay } from "node:timers/promises";
import {
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	type RelayAgentCommand,
} from "@apreal/shared";
import {
	ensureRelayAgentAuth,
	getRelayServerUrl,
	readClientTokenFromRequest,
	reauthenticateRelayAgent,
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
	reauthPending: boolean;
	reauthRunning: boolean;
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
	reauthenticateWithPairingCode(pairingCode: string): Promise<Awaited<ReturnType<typeof ensureRelayAgentAuth>>>;
	handleReauthenticationInput(rawValue: string): Promise<void>;
}

export function createRelay(
	state: RelayState,
	clientActions: ClientActions,
	handleClientMessage: (clientId: string, message: ClientAppMessage) => Promise<void>,
): RelayActions {
	const { logger, relayUrl, relayState, clients } = state;
	const { removeClientConnection, registerClientConnection, sendError, sendConnected } = clientActions;

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

	async function postRelayServerMessage(clientId: string, payload: ServerMessage) {
		if (!relayState.auth?.token) {
			throw new Error("Relay agent transport is not authenticated.");
		}

		const response = await fetch(new URL(RELAY_AGENT_MESSAGE_PATH, relayUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${relayState.auth.token}`,
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

		throw new Error(message);
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

	function ensureRelayClientConnection(clientId: string) {
		const existing = clients.get(clientId);
		const wasReady = existing?.ready ?? false;
		const client = registerClientConnection(clientId, "relay", createRelaySendPayload(clientId));
		client.ready = true;
		if (!wasReady) {
			sendConnected(clientId);
		}
		return client;
	}

	async function handleRelayAgentCommand(command: RelayAgentCommand) {
		switch (command.type) {
			case "client_connect": {
				ensureRelayClientConnection(command.clientId);
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

	async function runRelayTransportLoop(generation: number) {
		while (generation === relayState.transportGeneration) {
			const currentAuth = relayState.auth;
			if (!currentAuth?.token) {
				setRelayTransportDisconnected("relay_transport_unavailable");
				return;
			}

			const abortController = new AbortController();
			relayState.transportAbortController = abortController;

			try {
				await consumeRelayAgentStream(currentAuth.token, abortController.signal);
				if (abortController.signal.aborted || generation !== relayState.transportGeneration) {
					return;
				}

				logger.warn("relay agent stream ended; reconnecting", {
					relayUrl,
					agentId: currentAuth.agentId,
				});
			} catch (error) {
				if (abortController.signal.aborted || generation !== relayState.transportGeneration) {
					return;
				}

				logger.warn("relay agent stream disconnected", {
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

	async function reauthenticateWithPairingCode(pairingCode: string) {
		if (relayState.reauthRunning) {
			throw new Error("Relay reauthentication already in progress.");
		}

		relayState.reauthRunning = true;
		try {
			relayState.auth = await reauthenticateRelayAgent(logger, pairingCode, relayUrl);
			relayState.startupError = null;
			resetClientConnections("relay_reauthenticated");
			restartRelayTransport();
			logger.info("relay reauthentication completed", {
				agentId: relayState.auth.agentId,
				targetId: relayState.auth.targetId,
			});
			return relayState.auth;
		} finally {
			relayState.reauthPending = false;
			relayState.reauthRunning = false;
		}
	}

	async function handleReauthenticationInput(rawValue: string) {
		try {
			await reauthenticateWithPairingCode(rawValue);
			console.log("Relay reauthentication completed.");
		} catch (error) {
			const message = getErrorMessage(error);
			logger.warn("relay reauthentication failed", { error: message });
			console.error(`Relay reauthentication failed: ${message}`);
		}
	}

	return {
		getClientAuthErrorStatus,
		authenticateClientRequest,
		restartRelayTransport,
		reauthenticateWithPairingCode,
		handleReauthenticationInput,
	};
}
