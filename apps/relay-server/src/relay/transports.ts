import type { IncomingMessage, ServerResponse } from "node:http";
import type { RelayAgentCommand } from "@apreal/shared";
import { AuthError, readBearerTokenFromRequest, readRelayToken } from "../auth.ts";
import type { RelayServerState } from "./state.ts";
import { RELAY_SSE_HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import { readRequestBody, sendJson, setHeaders } from "./http.ts";
import { resolveClientRelayTarget } from "./authorization.ts";
import { parseRelayAgentMessage } from "./parsing.ts";
import { createSseChunk, createSseComment, createSseHeaders } from "./sse.ts";
import { log } from "../utils/log.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

export function createRelayTransportHandlers(state: RelayServerState) {
	function listBrowserClientsForAgent(agentId: string): RelayBrowserClientConnection[] {
		return Array.from(state.browserClients.values()).filter((client) => client.agentId === agentId && !client.closed);
	}

	function sendAgentCommand(agentId: string, command: RelayAgentCommand): boolean {
		const connection = state.agentConnections.get(agentId);
		if (!connection || connection.closed) {
			return false;
		}

		return connection.send(command);
	}

	function closeBrowserClient(clientId: string, reason: string) {
		const existing = state.browserClients.get(clientId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	function closeAgentConnection(agentId: string, reason: string) {
		const existing = state.agentConnections.get(agentId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	function notifyAgentOfConnectedClients(agentId: string) {
		for (const client of listBrowserClientsForAgent(agentId)) {
			sendAgentCommand(agentId, { type: "client_connect", clientId: client.clientId });
		}
	}

	function registerBrowserClientStream(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, state.tokenStore);
		response.statusCode = 200;
		setHeaders(response, createSseHeaders(corsHeaders));

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			connection.closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = state.browserClients.get(target.clientId);
			if (existing === connection) {
				state.browserClients.delete(target.clientId);
			}

			sendAgentCommand(target.agentId, {
				type: "client_disconnect",
				clientId: target.clientId,
				reason,
			});

			if (!response.writableEnded) {
				response.end();
			}
		};

		const connection: RelayBrowserClientConnection = {
			clientId: target.clientId,
			agentId: target.agentId,
			closed: false,
			send(payload) {
				if (closed || response.writableEnded) {
					return false;
				}

				try {
					response.write(createSseChunk(payload));
					return true;
				} catch {
					close("browser_stream_write_failed");
					return false;
				}
			},
			close(reason) {
				connection.closed = true;
				close(reason);
			},
		};

		const existing = state.browserClients.get(target.clientId);
		if (existing) {
			existing.close("browser_stream_replaced");
		}

		state.browserClients.set(target.clientId, connection);
		response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				response.write(createSseComment("ping"));
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			close("browser_stream_closed");
		});

		sendAgentCommand(target.agentId, { type: "client_connect", clientId: target.clientId });
		log("info", "relay browser stream connected", {
			clientId: target.clientId,
			agentId: target.agentId,
			browserClients: state.browserClients.size,
		});
	}

	async function handleClientMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, state.tokenStore);
		const browserClient = state.browserClients.get(target.clientId);
		if (!browserClient || browserClient.closed) {
			throw new AuthError("browser client stream is not connected");
		}

		if (!sendAgentCommand(target.agentId, {
			type: "client_message",
			clientId: target.clientId,
			message: JSON.parse(await readRequestBody(request)),
		})) {
			throw new AuthError("paired agent transport unavailable");
		}

		sendJson(response, 202, { ok: true }, corsHeaders);
	}

	function handleAgentStreamRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		if (!state.tokenStore.findActiveToken(token)) {
			throw new AuthError("unknown token");
		}

		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may open relay agent transport");
		}

		response.statusCode = 200;
		setHeaders(response, createSseHeaders(corsHeaders));

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			connection.closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = state.agentConnections.get(principal.id);
			if (existing === connection) {
				state.agentConnections.delete(principal.id);
			}

			for (const client of listBrowserClientsForAgent(principal.id)) {
				client.close(reason);
			}

			if (!response.writableEnded) {
				response.end();
			}
		};

		const closeConnection = (reason: string) => {
			close(reason);
		};

		const connection: RelayAgentConnection = {
			agentId: principal.id,
			closed: false,
			send(command) {
				if (closed || response.writableEnded) {
					return false;
				}

				try {
					response.write(createSseChunk(command));
					return true;
				} catch {
					closeConnection("agent_stream_write_failed");
					return false;
				}
			},
			close: closeConnection,
		};

		const existing = state.agentConnections.get(principal.id);
		if (existing) {
			existing.close("agent_stream_replaced");
		}

		state.agentConnections.set(principal.id, connection);
		response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				response.write(createSseComment("ping"));
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			closeConnection("agent_stream_closed");
		});

		notifyAgentOfConnectedClients(principal.id);
		log("info", "relay agent stream connected", {
			agentId: principal.id,
			agentConnections: state.agentConnections.size,
		});
	}

	async function handleAgentMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		if (!state.tokenStore.findActiveToken(token)) {
			throw new AuthError("unknown token");
		}

		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may post relay agent messages");
		}

		const payload = parseRelayAgentMessage(JSON.parse(await readRequestBody(request)));
		if (!payload) {
			sendJson(response, 400, { message: "Invalid relay agent message payload." }, corsHeaders);
			return;
		}

		const client = state.browserClients.get(payload.clientId);
		if (!client || client.closed || client.agentId !== principal.id) {
			sendJson(response, 409, { message: "Browser client stream is not connected." }, corsHeaders);
			return;
		}

		client.send(payload.message);
		sendJson(response, 202, { ok: true }, corsHeaders);
	}

	return {
		listBrowserClientsForAgent,
		sendAgentCommand,
		closeBrowserClient,
		closeAgentConnection,
		notifyAgentOfConnectedClients,
		registerBrowserClientStream,
		handleClientMessageRequest,
		handleAgentStreamRequest,
		handleAgentMessageRequest,
	};
}
