import WebSocket from "ws";
import { RELAY_SESSION_ACTION, type RelayOutboundEnvelope } from "@apreal/shared";
import { getErrorMessage } from "./session.ts";

type LoggerLike = {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
};

type RelayEnvelope = RelayOutboundEnvelope<unknown>;

type RelayAgentClientOptions = {
	relayUrl: string;
	agentId: string;
	getAgentJwt(): string;
	logger: LoggerLike;
	onClientMessage(clientId: string, payload: unknown): void;
	onDisconnect(): void;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRelayEnvelope(rawMessage: WebSocket.RawData): RelayEnvelope | null {
	let value: unknown;
	try {
		value = JSON.parse(rawMessage.toString());
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	if (
		(value.type !== "command" && value.type !== "response") ||
		(value.to !== "agent" && value.to !== "client") ||
		value.action !== RELAY_SESSION_ACTION ||
		typeof value.targetId !== "string" ||
		typeof value.fromId !== "string" ||
		(value.fromType !== "agent" && value.fromType !== "client")
	) {
		return null;
	}

	return {
		type: value.type,
		to: value.to,
		targetId: value.targetId,
		action: value.action,
		payload: value.payload,
		fromId: value.fromId,
		fromType: value.fromType,
	};
}

export function createRelayAgentClient(options: RelayAgentClientOptions) {
	const { relayUrl, agentId, getAgentJwt, logger, onClientMessage, onDisconnect } = options;
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	function clearReconnectTimer() {
		if (!reconnectTimer) {
			return;
		}

		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	function scheduleReconnect() {
		if (disposed || reconnectTimer) {
			return;
		}

		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, 1500);
	}

	function connect() {
		clearReconnectTimer();
		if (disposed) {
			return;
		}

		let agentJwt: string;
		try {
			agentJwt = getAgentJwt();
		} catch (error) {
			logger.error("failed to resolve relay agent token", {
				agentId,
				error: getErrorMessage(error),
			});
			scheduleReconnect();
			return;
		}

		logger.info("connecting to relay", {
			relayUrl,
			agentId,
		});

		socket = new WebSocket(relayUrl, {
			headers: {
				Authorization: `Bearer ${agentJwt}`,
			},
		});

		socket.on("open", () => {
			logger.info("relay connection established", {
				relayUrl,
				agentId,
			});
		});

		socket.on("message", (rawMessage) => {
			const envelope = parseRelayEnvelope(rawMessage);
			if (!envelope) {
				logger.warn("ignoring invalid relay payload");
				return;
			}

			if (envelope.fromType !== "client") {
				logger.warn("ignoring non-client relay payload", {
					fromType: envelope.fromType,
				});
				return;
			}

			onClientMessage(envelope.fromId, envelope.payload);
		});

		socket.on("error", (error) => {
			logger.warn("relay socket error", {
				error: getErrorMessage(error),
			});
		});

		socket.on("close", (code, reason) => {
			logger.warn("relay connection closed", {
				code,
				reason: reason.toString(),
			});
			socket = null;
			onDisconnect();
			scheduleReconnect();
		});
	}

	function sendToClient(clientId: string, payload: unknown): boolean {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			logger.warn("relay not ready for outbound client message", {
				clientId,
			});
			return false;
		}

		try {
			socket.send(
				JSON.stringify({
					type: "response",
					to: "client",
					targetId: clientId,
					action: RELAY_SESSION_ACTION,
					payload,
				}),
			);
			return true;
		} catch (error) {
			logger.warn("failed to send relay response", {
				clientId,
				error: getErrorMessage(error),
			});
			return false;
		}
	}

	function dispose() {
		disposed = true;
		clearReconnectTimer();
		if (socket) {
			socket.close();
			socket = null;
		}
	}

	connect();

	return {
		dispose,
		sendToClient,
		isConnected() {
			return socket?.readyState === WebSocket.OPEN;
		},
	};
}