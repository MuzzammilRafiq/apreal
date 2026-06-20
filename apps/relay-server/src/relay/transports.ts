import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { SYNC_LAST_SEQ_QUERY_PARAM, type RelayAgentCommand } from "@apreal/shared";
import { AuthError, readBearerTokenFromRequest, readRelayToken } from "../auth.ts";
import type { RelayServerState } from "./state.ts";
import { RELAY_SSE_HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import { readRequestBody, sendJson, setHeaders } from "./http.ts";
import { resolveClientRelayTarget } from "./authorization.ts";
import { parseRelayAgentMessage } from "./parsing.ts";
import { createSseChunk, createSseComment, createSseHeaders } from "./sse.ts";
import { log } from "../utils/log.ts";
import { audit, getAuditRequestFields } from "../utils/audit.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

// Builds the in-memory transport operations that attach browser and agent SSE
// streams and relay messages between them.
export function createRelayTransportHandlers(state: RelayServerState) {
	const browserWsServer = new WebSocketServer({ noServer: true });
	const agentWsServer = new WebSocketServer({ noServer: true });

	function isObjectRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

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

	function describeRelayPayload(payload: unknown): Record<string, unknown> {
		if (!isObjectRecord(payload)) {
			return { payloadType: "unknown" };
		}

		if (payload.type !== "sync_event" || !isObjectRecord(payload.payload)) {
			return {
				payloadType: typeof payload.type === "string" ? payload.type : "unknown",
				sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
				messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
				contentIndex: typeof payload.contentIndex === "number" ? payload.contentIndex : undefined,
				deltaLength: typeof payload.delta === "string" ? payload.delta.length : undefined,
			};
		}

		const innerPayload = payload.payload;
		const session = isObjectRecord(innerPayload.session) ? innerPayload.session : null;
		return {
			payloadType: "sync_event",
			seq: typeof payload.seq === "number" ? payload.seq : undefined,
			scope: typeof payload.scope === "string" ? payload.scope : undefined,
			innerType: typeof innerPayload.type === "string" ? innerPayload.type : "unknown",
			sessionId: typeof innerPayload.sessionId === "string"
				? innerPayload.sessionId
				: session && typeof session.id === "string"
					? session.id
					: undefined,
			revision: session && typeof session.revision === "number" ? session.revision : undefined,
			busy: session && typeof session.busy === "boolean" ? session.busy : undefined,
			transcriptLength: Array.isArray(innerPayload.transcript) ? innerPayload.transcript.length : undefined,
			messageId: typeof innerPayload.messageId === "string" ? innerPayload.messageId : undefined,
			contentIndex: typeof innerPayload.contentIndex === "number" ? innerPayload.contentIndex : undefined,
			deltaLength: typeof innerPayload.delta === "string" ? innerPayload.delta.length : undefined,
		};
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

	function rejectWebSocketUpgrade(socket: Duplex, statusCode: number, message: string) {
		socket.write([
			`HTTP/1.1 ${statusCode} ${message}`,
			"Connection: close",
			"Content-Type: text/plain; charset=utf-8",
			`Content-Length: ${Buffer.byteLength(message)}`,
			"",
			message,
		].join("\r\n"));
		socket.destroy();
	}

	// Returns every currently open browser stream paired to one agent.
	function listBrowserClientsForAgent(agentId: string): RelayBrowserClientConnection[] {
		return Array.from(state.browserClients.values()).filter((client) => client.agentId === agentId && !client.closed);
	}

	// Pushes a command to an agent's active SSE stream, if that stream exists.
	function sendAgentCommand(agentId: string, command: RelayAgentCommand): boolean {
		const connection = state.agentConnections.get(agentId);
		if (!connection || connection.closed) {
			log("warn", "relay agent command skipped; agent stream unavailable", {
				agentId,
				commandType: command.type,
				clientId: command.clientId,
			});
			return false;
		}

		return connection.send(command);
	}

	function getBrowserDisconnectMessage(reason: string): string | null {
		if (reason === "agent_owner_session_replaced") {
			return "Your Apreal agent changed because this account signed in on another computer.";
		}

		return null;
	}

	function assertActiveAgentPrincipal(principal: ReturnType<typeof readRelayToken>) {
		if (!principal.ownerUserId) {
			return;
		}

		if (principal.type !== "agent" || !principal.key) {
			throw new AuthError("agent credential is missing");
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
		const target = resolveClientRelayTarget(request, state.credentialStore);
		const lastSeq = readLastSeqFromRequest(request);
		response.statusCode = 200;
		setHeaders(response, createSseHeaders(corsHeaders));
		response.socket?.setNoDelay(true);
		response.flushHeaders();

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
		let waitingForBrowserDrain = false;
		let browserDrainTimer: ReturnType<typeof setTimeout> | null = null;

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
			if (browserDrainTimer) {
				clearTimeout(browserDrainTimer);
				browserDrainTimer = null;
			}

			const existing = state.browserClients.get(target.clientId);
			const isActiveConnection = existing === connection;
			if (isActiveConnection) {
				state.browserClients.delete(target.clientId);
			}

			if (isActiveConnection && reason !== "browser_stream_replaced") {
				sendAgentCommand(target.agentId, {
					type: "client_disconnect",
					clientId: target.clientId,
					reason,
				});
			}

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
					log("warn", "relay browser payload skipped; browser stream closed", {
						clientId: target.clientId,
						agentId: target.agentId,
						...describeRelayPayload(payload),
					});
					return false;
				}

				try {
					const writeAccepted = response.write(createSseChunk(payload));
					if (!writeAccepted && !waitingForBrowserDrain) {
						waitingForBrowserDrain = true;
						browserDrainTimer = setTimeout(() => {
							log("warn", "relay browser stream drain timed out; closing stream", {
								clientId: target.clientId,
								agentId: target.agentId,
								writableLength: response.writableLength,
								writableNeedDrain: response.writableNeedDrain,
								socketBufferSize: response.socket?.bufferSize,
								...describeRelayPayload(payload),
							});
							close("browser_stream_backpressure_timeout");
						}, 5_000);
						response.once("drain", () => {
							waitingForBrowserDrain = false;
							if (browserDrainTimer) {
								clearTimeout(browserDrainTimer);
								browserDrainTimer = null;
							}
						});
					}
					// A false return from response.write means the data was queued and the
					// stream needs drain, not that delivery failed.
					return true;
				} catch {
					log("warn", "relay browser payload write threw", {
						clientId: target.clientId,
						agentId: target.agentId,
					});
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
		const openCommentAccepted = response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				const heartbeatAccepted = response.write(createSseComment("ping"));
				if (!heartbeatAccepted || response.writableNeedDrain) {
					log("warn", "relay browser heartbeat queued with backpressure", {
						clientId: target.clientId,
						agentId: target.agentId,
						writeAccepted: heartbeatAccepted,
						writableLength: response.writableLength,
						writableNeedDrain: response.writableNeedDrain,
						socketBufferSize: response.socket?.bufferSize,
					});
				}
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			close("browser_stream_closed");
		});

		sendAgentCommand(target.agentId, { type: "client_connect", clientId: target.clientId, lastSeq });
	}

	function registerBrowserWebSocketConnection(
		ws: WebSocket,
		target: ReturnType<typeof resolveClientRelayTarget>,
		lastSeq: number | undefined,
	) {
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
			const isActiveConnection = existing === connection;
			if (isActiveConnection) {
				state.browserClients.delete(target.clientId);
			}

			if (isActiveConnection && reason !== "browser_stream_replaced") {
				sendAgentCommand(target.agentId, {
					type: "client_disconnect",
					clientId: target.clientId,
					reason,
				});
			}

			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.close(1000, reason);
			}
		};

		const connection: RelayBrowserClientConnection = {
			clientId: target.clientId,
			agentId: target.agentId,
			ownerUserId: target.ownerUserId ?? null,
			closed: false,
			send(payload) {
				if (closed || ws.readyState !== WebSocket.OPEN) {
					log("warn", "relay browser websocket payload skipped; socket not open", {
						clientId: target.clientId,
						agentId: target.agentId,
						readyState: ws.readyState,
						bufferedAmount: ws.bufferedAmount,
						...describeRelayPayload(payload),
					});
					return false;
				}

				const data = JSON.stringify(payload);
				ws.send(data, (error) => {
					if (error) {
						log("warn", "relay browser websocket payload send failed", {
							clientId: target.clientId,
							agentId: target.agentId,
							error: error.message,
							...describeRelayPayload(payload),
						});
						close("browser_ws_send_failed");
						return;
					}

				});
				return true;
			},
			close,
		};

		const existing = state.browserClients.get(target.clientId);
		if (existing) {
			existing.close("browser_stream_replaced");
		}

		state.browserClients.set(target.clientId, connection);

		ws.on("message", (data) => {
			let message: unknown;
			const rawMessage = getWebSocketMessageText(data);
			try {
				message = JSON.parse(rawMessage);
			} catch {
				log("warn", "relay browser websocket ignored invalid json", {
					clientId: target.clientId,
					agentId: target.agentId,
					rawLength: rawMessage.length,
				});
				connection.send({ type: "error", message: "Invalid client message payload." });
				return;
			}

			if (!sendAgentCommand(target.agentId, {
				type: "client_message",
				clientId: target.clientId,
				message,
			})) {
				log("warn", "relay browser websocket message could not reach paired agent", {
					clientId: target.clientId,
					agentId: target.agentId,
				});
				connection.send({ type: "error", message: "Paired agent transport unavailable." });
			}
		});

		ws.on("close", (code, reason) => {
			close("browser_ws_closed");
		});

		ws.on("error", (error) => {
			log("warn", "relay browser websocket error", {
				clientId: target.clientId,
				agentId: target.agentId,
				error: error.message,
			});
			close("browser_ws_error");
		});

		heartbeatTimer = setInterval(() => {
			if (closed || ws.readyState !== WebSocket.OPEN) {
				return;
			}

			if (ws.bufferedAmount > 0) {
				log("warn", "relay browser websocket heartbeat sees buffered data", {
					clientId: target.clientId,
					agentId: target.agentId,
					bufferedAmount: ws.bufferedAmount,
				});
			}

			ws.ping();
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		sendAgentCommand(target.agentId, { type: "client_connect", clientId: target.clientId, lastSeq });
	}

	function handleBrowserClientWebSocketUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	) {
		let target: ReturnType<typeof resolveClientRelayTarget>;
		let lastSeq: number | undefined;
		try {
			target = resolveClientRelayTarget(request, state.credentialStore);
			lastSeq = readLastSeqFromRequest(request);
		} catch (error) {
			audit("authorization.failed", "failure", {
				actorType: "client",
				...getAuditRequestFields(request),
				statusCode: 401,
				reason: "request_rejected",
				transport: "websocket",
			});
			log("warn", "relay browser websocket rejected", {
				error: error instanceof Error ? error.message : "browser websocket authorization failed",
			});
			rejectWebSocketUpgrade(socket, 401, "Unauthorized");
			return;
		}

		browserWsServer.handleUpgrade(request, socket, head, (ws) => {
			registerBrowserWebSocketConnection(ws, target, lastSeq);
		});
	}

	// Accepts one browser-originated message payload and forwards it to the
	// paired agent command stream.
	async function handleClientMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, state.credentialStore);
		const browserClient = state.browserClients.get(target.clientId);
		if (!browserClient || browserClient.closed) {
			log("warn", "relay client message rejected; browser stream not connected", {
				clientId: target.clientId,
				agentId: target.agentId,
			});
			throw new AuthError("browser client stream is not connected");
		}

		const body = await readRequestBody(request);
		const parsedBody = JSON.parse(body);
		if (!sendAgentCommand(target.agentId, {
			type: "client_message",
			clientId: target.clientId,
			message: parsedBody,
		})) {
			log("warn", "relay client message could not reach paired agent", {
				clientId: target.clientId,
				agentId: target.agentId,
			});
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
		const principal = readRelayToken(token, { credentialStore: state.credentialStore });
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
			credentialId: principal.credentialId,
			ownerUserId: principal.ownerUserId ?? null,
			closed: false,
			send(command) {
				if (closed || response.writableEnded) {
					log("warn", "relay agent command skipped; stream closed during send", {
						agentId: principal.id,
						commandType: command.type,
						clientId: command.clientId,
					});
					return false;
				}

				try {
					response.write(createSseChunk(command));
					return true;
				} catch {
					log("warn", "relay agent command write threw", {
						agentId: principal.id,
						commandType: command.type,
						clientId: command.clientId,
					});
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
	}

	function deliverAgentMessageToBrowser(
		principal: ReturnType<typeof readRelayToken>,
		payload: NonNullable<ReturnType<typeof parseRelayAgentMessage>>,
	): boolean {
		const client = state.browserClients.get(payload.clientId);
		if (!client || client.closed || client.agentId !== principal.id) {
			log("warn", "relay agent message rejected; browser client unavailable", {
				agentId: principal.id,
				clientId: payload.clientId,
				hasClient: Boolean(client),
				clientClosed: client?.closed,
				clientAgentId: client?.agentId,
			});
			return false;
		}

		const queuedToBrowser = client.send(payload.message);
		return queuedToBrowser;
	}

	function registerAgentWebSocketConnection(
		ws: WebSocket,
		principal: ReturnType<typeof readRelayToken>,
	) {
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

			if (reason === "agent_owner_session_replaced") {
				for (const client of listBrowserClientsForAgent(principal.id)) {
					client.close(reason);
				}
			}

			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.close(1000, reason);
			}
		};

		const connection: RelayAgentConnection = {
			agentId: principal.id,
			credentialId: principal.credentialId,
			ownerUserId: principal.ownerUserId ?? null,
			closed: false,
			send(command) {
				if (closed || ws.readyState !== WebSocket.OPEN) {
					log("warn", "relay agent websocket command skipped; socket not open", {
						agentId: principal.id,
						commandType: command.type,
						clientId: command.clientId,
						readyState: ws.readyState,
						bufferedAmount: ws.bufferedAmount,
					});
					return false;
				}

				const data = JSON.stringify(command);
				ws.send(data, (error) => {
					if (error) {
						log("warn", "relay agent websocket command send failed", {
							agentId: principal.id,
							commandType: command.type,
							clientId: command.clientId,
							error: error.message,
						});
						close("agent_ws_send_failed");
						return;
					}

				});
				return true;
			},
			close,
		};

		const existing = state.agentConnections.get(principal.id);
		if (existing) {
			existing.close("agent_stream_replaced");
		}
		if (principal.ownerUserId) {
			closeAgentConnectionsForOwner(principal.ownerUserId, principal.id, "agent_owner_session_replaced");
		}

		state.agentConnections.set(principal.id, connection);

		ws.on("message", (data) => {
			let parsed: unknown;
			const rawMessage = getWebSocketMessageText(data);
			try {
				parsed = JSON.parse(rawMessage);
			} catch {
				log("warn", "relay agent websocket ignored invalid json", {
					agentId: principal.id,
					rawLength: rawMessage.length,
				});
				return;
			}

			const payload = parseRelayAgentMessage(parsed);
			if (!payload) {
				log("warn", "relay agent websocket ignored invalid message", {
					agentId: principal.id,
					rawLength: rawMessage.length,
				});
				return;
			}

			deliverAgentMessageToBrowser(principal, payload);
		});

		ws.on("close", (code, reason) => {
			close("agent_ws_closed");
		});

		ws.on("error", (error) => {
			log("warn", "relay agent websocket error", {
				agentId: principal.id,
				error: error.message,
			});
			close("agent_ws_error");
		});

		heartbeatTimer = setInterval(() => {
			if (closed || ws.readyState !== WebSocket.OPEN) {
				return;
			}

			if (ws.bufferedAmount > 0) {
				log("warn", "relay agent websocket heartbeat sees buffered data", {
					agentId: principal.id,
					bufferedAmount: ws.bufferedAmount,
				});
			}

			ws.ping();
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		notifyAgentOfConnectedClients(principal.id);
	}

	function handleAgentWebSocketUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	) {
		let principal: ReturnType<typeof readRelayToken>;
		try {
			const token = readBearerTokenFromRequest(request);
			principal = readRelayToken(token, { credentialStore: state.credentialStore });
			if (principal.type !== "agent") {
				throw new AuthError("only agent tokens may open relay agent transport");
			}
			assertActiveAgentPrincipal(principal);
		} catch (error) {
			audit("authorization.failed", "failure", {
				actorType: "agent",
				...getAuditRequestFields(request),
				statusCode: 401,
				reason: "request_rejected",
				transport: "websocket",
			});
			log("warn", "relay agent websocket rejected", {
				error: error instanceof Error ? error.message : "agent websocket authorization failed",
			});
			rejectWebSocketUpgrade(socket, 401, "Unauthorized");
			return;
		}

		agentWsServer.handleUpgrade(request, socket, head, (ws) => {
			registerAgentWebSocketConnection(ws, principal);
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
		const principal = readRelayToken(token, { credentialStore: state.credentialStore });
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may post relay agent messages");
		}
		assertActiveAgentPrincipal(principal);

		const payload = parseRelayAgentMessage(JSON.parse(await readRequestBody(request)));
		if (!payload) {
			sendJson(response, 400, { message: "Invalid relay agent message payload." }, corsHeaders);
			return;
		}

		if (!deliverAgentMessageToBrowser(principal, payload)) {
			sendJson(response, 409, { message: "Browser client stream is not connected." }, corsHeaders);
			return;
		}

		sendJson(response, 202, { ok: true }, corsHeaders);
	}

	return {
		listBrowserClientsForAgent,
		sendAgentCommand,
		closeBrowserClient,
		closeAgentConnection,
		closeAgentConnectionsForOwner,
		notifyAgentOfConnectedClients,
		registerBrowserClientStream,
		handleBrowserClientWebSocketUpgrade,
		handleClientMessageRequest,
		handleAgentStreamRequest,
		handleAgentWebSocketUpgrade,
		handleAgentMessageRequest,
	};
}
