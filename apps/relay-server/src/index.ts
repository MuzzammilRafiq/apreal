import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "dotenv";
import { CLIENT_EVENT_STREAM_PATH, CLIENT_MESSAGE_PATH, RELAY_AGENT_AUTH_PATH, RELAY_AGENT_MESSAGE_PATH, RELAY_AGENT_STREAM_PATH, RELAY_CLIENT_AUTH_PATH, RELAY_CLIENT_HEARTBEAT_PATH, RELAY_CONNECTION_PATH, type RelayAgentCommand } from "@apreal/shared";
import { AuthError, readBearerTokenFromRequest, readRelayToken } from "./auth.ts";
import { RelayTokenStore } from "./token-store.ts";
import { DEFAULT_PORT, RELAY_SSE_HEARTBEAT_INTERVAL_MS, TOKEN_REFRESH_WINDOW_MS, ANSI_RESET, TIMESTAMP_COLOR, DATA_COLOR, LEVEL_COLORS, TAG_COLORS, parsePort, supportsColor, colorize, pickTagColor, log, isObjectRecord, readStringField, readUrlField, createCorsHeaders, buildHealthPayload, getErrorMessage, readOptionalBearerToken, readClientTokenFromProxyRequest, setHeaders, sendJson, sendText, readRequestBody, parseRelayConnectionRequest, parseClientAuthRequest, parseAgentAuthRequest, getDefaultTargetType, authorizeRelayConnection, mapRelayConnectionErrorStatus, resolveTargetFromPayload, shouldRefreshToken, resolveRequestOrigin, validateAgentServerUrl, resolveClientRelayTarget, mapRelayProxyErrorStatus, createSseChunk, createSseComment, parseRelayAgentMessage, buildClientAuthResponse, buildClientHeartbeatResponse, buildAgentAuthResponse, type RelayBrowserClientConnection, type RelayAgentConnection } from "./relay-utils.ts";

export function runRelayServer(options?: { port?: number }) {
	const port = options?.port ?? parsePort(process.env.PORT);
	const tokenStore = new RelayTokenStore();
	const browserClients = new Map<string, RelayBrowserClientConnection>();
	const agentConnections = new Map<string, RelayAgentConnection>();

	function listBrowserClientsForAgent(agentId: string): RelayBrowserClientConnection[] {
		return Array.from(browserClients.values()).filter((client) => client.agentId === agentId && !client.closed);
	}

	function sendAgentCommand(agentId: string, command: RelayAgentCommand): boolean {
		const connection = agentConnections.get(agentId);
		if (!connection || connection.closed) {
			return false;
		}

		return connection.send(command);
	}

	function closeBrowserClient(clientId: string, reason: string) {
		const existing = browserClients.get(clientId);
		if (!existing) {
			return;
		}

		existing.close(reason);
	}

	function closeAgentConnection(agentId: string, reason: string) {
		const existing = agentConnections.get(agentId);
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
		const target = resolveClientRelayTarget(request, tokenStore);
		response.statusCode = 200;
		setHeaders(response, {
			...corsHeaders,
			"cache-control": "no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		});

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = browserClients.get(target.clientId);
			if (existing?.close === close) {
				browserClients.delete(target.clientId);
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
			close,
		};

		const existing = browserClients.get(target.clientId);
		if (existing) {
			existing.close("browser_stream_replaced");
		}

		browserClients.set(target.clientId, connection);
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
			browserClients: browserClients.size,
		});
	}

	async function handleClientMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const target = resolveClientRelayTarget(request, tokenStore);
		const browserClient = browserClients.get(target.clientId);
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
		if (!tokenStore.findActiveToken(token)) {
			throw new AuthError("unknown token");
		}

		const principal = readRelayToken(token);
		if (principal.type !== "agent") {
			throw new AuthError("only agent tokens may open relay agent transport");
		}

		response.statusCode = 200;
		setHeaders(response, {
			...corsHeaders,
			"cache-control": "no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		});

		let closed = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const close = (reason: string) => {
			if (closed) {
				return;
			}

			closed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}

			const existing = agentConnections.get(principal.id);
			if (existing?.close === close) {
				agentConnections.delete(principal.id);
			}

			for (const client of listBrowserClientsForAgent(principal.id)) {
				client.close(reason);
			}

			if (!response.writableEnded) {
				response.end();
			}
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
					close("agent_stream_write_failed");
					return false;
				}
			},
			close,
		};

		const existing = agentConnections.get(principal.id);
		if (existing) {
			existing.close("agent_stream_replaced");
		}

		agentConnections.set(principal.id, connection);
		response.write(createSseComment("connected"));
		heartbeatTimer = setInterval(() => {
			if (!closed) {
				response.write(createSseComment("ping"));
			}
		}, RELAY_SSE_HEARTBEAT_INTERVAL_MS);

		request.on("close", () => {
			close("agent_stream_closed");
		});

		notifyAgentOfConnectedClients(principal.id);
		log("info", "relay agent stream connected", {
			agentId: principal.id,
			agentConnections: agentConnections.size,
		});
	}

	async function handleAgentMessageRequest(
		request: IncomingMessage,
		response: ServerResponse,
		corsHeaders: Record<string, string>,
	) {
		const token = readBearerTokenFromRequest(request);
		if (!tokenStore.findActiveToken(token)) {
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

		const client = browserClients.get(payload.clientId);
		if (!client || client.closed || client.agentId !== principal.id) {
			sendJson(response, 409, { message: "Browser client stream is not connected." }, corsHeaders);
			return;
		}

		client.send(payload.message);
		sendJson(response, 202, { ok: true }, corsHeaders);
	}
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		const corsHeaders = createCorsHeaders();

		if (pathname === "/" || pathname === "/health") {
			sendJson(response, 200, buildHealthPayload(corsHeaders, tokenStore), corsHeaders);
			return;
		}

		if (pathname === RELAY_CLIENT_AUTH_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			const clientAuthRequest = await parseClientAuthRequest(request);
			if (!clientAuthRequest) {
				sendJson(response, 400, { message: "Invalid client auth request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"client",
					clientAuthRequest.clientId,
					clientAuthRequest.clientKey,
					{ allowExpired: true },
				);
				if (issuedToken && shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.targetId ? undefined : issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
					});
				}

				if (!issuedToken) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: clientAuthRequest.clientId,
						key: clientAuthRequest.clientKey,
						pairingCode: tokenStore.createPairingCode(),
					});
				}

				log("info", "issued client auth token", {
					clientId: issuedToken.payload.id,
					paired: Boolean(issuedToken.payload.targetId),
				});
				sendJson(response, 200, buildClientAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "client auth failed";
				log("warn", "client auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_CLIENT_HEARTBEAT_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			const clientHeartbeatRequest = await parseClientAuthRequest(request);
			if (!clientHeartbeatRequest) {
				sendJson(response, 400, { message: "Invalid relay heartbeat request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"client",
					clientHeartbeatRequest.clientId,
					clientHeartbeatRequest.clientKey,
					{ allowExpired: true },
				);
				if (!issuedToken) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: clientHeartbeatRequest.clientId,
						key: clientHeartbeatRequest.clientKey,
						pairingCode: tokenStore.createPairingCode(),
					});
				} else if (shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "client",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.targetId ? undefined : issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
					});
				}

				sendJson(response, 200, buildClientHeartbeatResponse(issuedToken, tokenStore, agentConnections), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "relay heartbeat failed";
				log("warn", "relay heartbeat failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_AUTH_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			const agentAuthRequest = await parseAgentAuthRequest(request);
			if (!agentAuthRequest) {
				sendJson(response, 400, { message: "Invalid agent auth request." }, corsHeaders);
				return;
			}

			try {
				let issuedToken = tokenStore.findLatestByPrincipal(
					"agent",
					agentAuthRequest.agentId,
					agentAuthRequest.agentKey,
					{ allowExpired: true },
				);
				if (agentAuthRequest.pairingCode) {
					const pairedClient = tokenStore.findPendingClientByPairingCode(agentAuthRequest.pairingCode);
					if (!pairedClient) {
						sendJson(response, 404, { message: "Pairing code was not found." }, corsHeaders);
						return;
					}

					const previousClient = tokenStore.findLatestClientByTargetId(agentAuthRequest.agentId, {
						allowExpired: true,
					});
					if (previousClient && previousClient.payload.id !== pairedClient.payload.id) {
						tokenStore.clearClientTarget(previousClient);
					}

					tokenStore.issueToken({
						type: "client",
						id: pairedClient.payload.id,
						key: pairedClient.payload.key,
						targetId: agentAuthRequest.agentId,
						targetType: "agent",
						pairingCode: pairedClient.payload.pairingCode,
					});

					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: agentAuthRequest.agentId,
						key: agentAuthRequest.agentKey,
						targetId: pairedClient.payload.id,
						targetType: "client",
						pairingCode: pairedClient.payload.pairingCode,
					});
				}
				if (issuedToken && !agentAuthRequest.pairingCode && shouldRefreshToken(issuedToken)) {
					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: issuedToken.payload.id,
						key: issuedToken.payload.key,
						pairingCode: issuedToken.payload.pairingCode,
						targetId: issuedToken.payload.targetId,
						targetType: issuedToken.payload.targetType,
					});
				}

				if (!issuedToken) {
					if (!agentAuthRequest.pairingCode) {
						sendJson(response, 400, { message: "Pairing code is required for first-time agent auth." }, corsHeaders);
						return;
					}

					const pairedClient = tokenStore.findPendingClientByPairingCode(agentAuthRequest.pairingCode);
					if (!pairedClient) {
						sendJson(response, 404, { message: "Pairing code was not found." }, corsHeaders);
						return;
					}

					tokenStore.issueToken({
						type: "client",
						id: pairedClient.payload.id,
						key: pairedClient.payload.key,
						targetId: agentAuthRequest.agentId,
						targetType: "agent",
						pairingCode: pairedClient.payload.pairingCode,
					});

					issuedToken = tokenStore.issueToken({
						type: "agent",
						id: agentAuthRequest.agentId,
						key: agentAuthRequest.agentKey,
						targetId: pairedClient.payload.id,
						targetType: "client",
						pairingCode: pairedClient.payload.pairingCode,
					});
				}

				log("info", "issued agent auth token", {
					agentId: issuedToken.payload.id,
					targetId: issuedToken.payload.targetId,
					connected: Boolean(agentConnections.get(issuedToken.payload.id)),
				});
				sendJson(response, 200, buildAgentAuthResponse(issuedToken), corsHeaders);
			} catch (error) {
				const message = error instanceof Error ? error.message : "agent auth failed";
				log("warn", "agent auth failed", { error: message });
				sendJson(response, 500, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_STREAM_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "GET") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			try {
				handleAgentStreamRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may open relay agent transport" ? 403 : 401;
				log("warn", "relay agent stream rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_AGENT_MESSAGE_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			try {
				await handleAgentMessageRequest(request, response, corsHeaders);
			} catch (error) {
				const message = getErrorMessage(error);
				const statusCode = message === "only agent tokens may post relay agent messages" ? 403 : 401;
				log("warn", "relay agent message rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === CLIENT_EVENT_STREAM_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "GET") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			try {
				registerBrowserClientStream(request, response, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay stream request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === CLIENT_MESSAGE_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			try {
				await handleClientMessageRequest(request, response, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayProxyErrorStatus(error);
				const message = getErrorMessage(error);
				log("warn", "relay message request rejected", { error: message });
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		if (pathname === RELAY_CONNECTION_PATH) {
			if (request.method === "OPTIONS") {
				response.statusCode = 204;
				setHeaders(response, corsHeaders);
				response.end();
				return;
			}

			if (request.method !== "POST") {
				sendText(response, 405, "Method Not Allowed", corsHeaders);
				return;
			}

			const connectionRequest = await parseRelayConnectionRequest(request);
			if (!connectionRequest) {
				sendJson(response, 400, { message: "Invalid relay connection request." }, corsHeaders);
				return;
			}

			try {
				const token = readBearerTokenFromRequest(request);
				if (!tokenStore.findActiveToken(token)) {
					throw new AuthError("unknown token");
				}

				const principal = readRelayToken(token);
				const payload = authorizeRelayConnection(principal, connectionRequest);
				log("info", "authenticated relay http connection", {
					principalId: payload.principal.id,
					principalType: payload.principal.type,
					targetId: payload.target.id,
					targetType: payload.target.type,
					scopedToTarget: payload.principal.scopedToTarget,
				});
				sendJson(response, 200, payload, corsHeaders);
			} catch (error) {
				const statusCode = mapRelayConnectionErrorStatus(error);
				const message = error instanceof Error ? error.message : "relay connection authorization failed";
				log("warn", "relay http connection rejected", {
					error: message,
				});
				sendJson(response, statusCode, { message }, corsHeaders);
			}
			return;
		}

		sendText(response, 404, "Not Found", corsHeaders);
	});

	server.listen(port);

	log("info", "relay server listening", {
		port,
		transport: "http",
		tokenStorePath: tokenStore.getFilePath(),
		tokenCount: tokenStore.countTokens({ allowExpired: true }),
	});

	return server;
}

runRelayServer();
