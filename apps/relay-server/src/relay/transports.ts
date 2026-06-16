import type { IncomingMessage, ServerResponse } from "node:http";
import { SYNC_LAST_SEQ_QUERY_PARAM, type RelayAgentCommand } from "@apreal/shared";
import { AuthError, readBearerTokenFromRequest, readRelayToken } from "../auth.ts";
import type { RelayServerState } from "./state.ts";
import { RELAY_SSE_HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import { readRequestBody, sendJson, setHeaders } from "./http.ts";
import { resolveClientRelayTarget } from "./authorization.ts";
import { parseRelayAgentMessage } from "./parsing.ts";
import { createSseChunk, createSseComment, createSseHeaders } from "./sse.ts";
import { log } from "../utils/log.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

// Builds the in-memory transport operations that attach browser and agent SSE
// streams and relay messages between them.
export function createRelayTransportHandlers(state: RelayServerState) {
	function readLastSeqFromRequest(request: IncomingMessage): number | undefined {
		const headerValue = request.headers["last-event-id"];
		const rawHeaderValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		const queryValue = new URL(request.url ?? "/", "http://relay.local").searchParams.get(SYNC_LAST_SEQ_QUERY_PARAM);
		const rawValue = rawHeaderValue ?? queryValue;
		if (!rawValue) {
			return undefined;
		}

		const value = Number.parseInt(rawValue, 10);
		return Number.isInteger(value) && value >= 0 ? value : undefined;
	}

	// Returns every currently open browser stream paired to one agent.
	function listBrowserClientsForAgent(agentId: string): RelayBrowserClientConnection[] {
		return Array.from(state.browserClients.values()).filter((client) => client.agentId === agentId && !client.closed);
	}

	// Pushes a command to an agent's active SSE stream, if that stream exists.
	function sendAgentCommand(agentId: string, command: RelayAgentCommand): boolean {
		const connection = state.agentConnections.get(agentId);
		if (!connection || connection.closed) {
			return false;
		}

		return connection.send(command);
	}

	function getBrowserDisconnectMessage(reason: string): string | null {
		if (reason === "browser_owner_session_replaced") {
			return "You were signed out because your account opened Apreal somewhere else.";
		}

		if (reason === "agent_owner_session_replaced") {
			return "Your Apreal agent changed because this account signed in on another computer.";
		}

		return null;
	}

	function assertActiveBrowserClient(ownerUserId: string | undefined, clientId: string) {
		if (!ownerUserId) {
			return;
		}

		const activeClientId = state.activeClientIdsByOwner.get(ownerUserId);
		if (activeClientId && activeClientId !== clientId) {
			throw new AuthError("client session was replaced");
		}
	}

	function assertActiveAgentPrincipal(principal: ReturnType<typeof readRelayToken>) {
		if (!principal.ownerUserId) {
			return;
		}

		const ownerUserId = state.ownerBindingStore.findOwnerUserIdForAgent(principal.id, principal.key);
		if (ownerUserId !== principal.ownerUserId) {
			throw new AuthError("agent session was replaced");
		}
	}

	// Closes one browser stream by id through its connection handle.
	function closeBrowserClient(clientId: string, reason: string) {
		const existing = state.browserClients.get(clientId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	// Closes every browser stream owned by an account except the stream that is
	// becoming active.
	function closeBrowserClientsForOwner(ownerUserId: string, exceptClientId: string, reason: string) {
		for (const client of Array.from(state.browserClients.values())) {
			if (client.ownerUserId === ownerUserId && client.clientId !== exceptClientId && !client.closed) {
				client.close(reason);
			}
		}
	}

	// Closes one agent stream by id through its connection handle.
	function closeAgentConnection(agentId: string, reason: string) {
		const existing = state.agentConnections.get(agentId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	// Closes every active agent stream owned by an account except the stream
	// that is becoming active.
	function closeAgentConnectionsForOwner(ownerUserId: string, exceptAgentId: string, reason: string) {
		for (const connection of Array.from(state.agentConnections.values())) {
			if (connection.ownerUserId === ownerUserId && connection.agentId !== exceptAgentId && !connection.closed) {
				connection.close(reason);
			}
		}
	}

	// Replays synthetic client_connect events when an agent stream appears after
	// browser streams were already open.
	function notifyAgentOfConnectedClients(agentId: string) {
		for (const client of listBrowserClientsForAgent(agentId)) {
			sendAgentCommand(agentId, { type: "client_connect", clientId: client.clientId });
		}
	}

	// Opens and registers the browser-facing SSE stream used to receive server
	// events from the paired agent.
	function registerBrowserClientStream(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request);
		const lastSeq = readLastSeqFromRequest(request);
		assertActiveBrowserClient(target.ownerUserId, target.clientId);
		response.statusCode = 200;
		setHeaders(response, createSseHeaders(corsHeaders));

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		// Tears down the browser stream, removes it from state, and notifies the
		// paired agent that the client disappeared.
		const close = (reason: string) => {
			if (closed) {
				return;
			}

			const message = getBrowserDisconnectMessage(reason);
			if (message && !response.writableEnded) {
				response.write(createSseChunk({ type: "disconnected", reason, message }));
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

		// The runtime handle the rest of the relay uses to talk to this browser
		// client or close it later.
		const connection: RelayBrowserClientConnection = {
			clientId: target.clientId,
			agentId: target.agentId,
			ownerUserId: target.ownerUserId ?? null,
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
		if (target.ownerUserId) {
			closeBrowserClientsForOwner(target.ownerUserId, target.clientId, "browser_owner_session_replaced");
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

		sendAgentCommand(target.agentId, { type: "client_connect", clientId: target.clientId, lastSeq });
		log("info", "relay browser stream connected", {
			clientId: target.clientId,
			agentId: target.agentId,
			browserClients: state.browserClients.size,
		});
	}

	// Accepts one browser-originated message payload and forwards it to the
	// paired agent command stream.
	async function handleClientMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request);
		assertActiveBrowserClient(target.ownerUserId, target.clientId);
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

	// Opens and registers the agent-facing SSE stream used to receive commands
	// from the relay on behalf of connected browser clients.
	function handleAgentStreamRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may open relay agent transport");
		}
		assertActiveAgentPrincipal(principal);

		response.statusCode = 200;
		setHeaders(response, createSseHeaders(corsHeaders));

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		// Tears down the agent stream and closes every browser client that was
		// paired to it because they no longer have an upstream.
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

			if (reason === "agent_owner_session_replaced") {
				for (const client of listBrowserClientsForAgent(principal.id)) {
					client.close(reason);
				}
			}

			if (!response.writableEnded) {
				response.end();
			}
		};

		// Named wrapper so the connection object can expose a stable close method.
		const closeConnection = (reason: string) => {
			close(reason);
		};

		// The runtime handle the relay uses to deliver commands to this agent.
		const connection: RelayAgentConnection = {
			agentId: principal.id,
			ownerUserId: principal.ownerUserId ?? null,
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
		if (principal.ownerUserId) {
			closeAgentConnectionsForOwner(principal.ownerUserId, principal.id, "agent_owner_session_replaced");
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

	// Accepts one agent-originated server message and forwards it to the
	// browser client currently paired to that same agent.
	async function handleAgentMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may post relay agent messages");
		}
		assertActiveAgentPrincipal(principal);

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
		closeBrowserClientsForOwner,
		closeAgentConnection,
		closeAgentConnectionsForOwner,
		notifyAgentOfConnectedClients,
		registerBrowserClientStream,
		handleClientMessageRequest,
		handleAgentStreamRequest,
		handleAgentMessageRequest,
	};
}
