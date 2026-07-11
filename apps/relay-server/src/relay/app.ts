import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import express, { type ErrorRequestHandler } from "express";
import {
	CLIENT_EVENT_STREAM_PATH,
	RELAY_AGENT_STREAM_PATH,
} from "@apreal/shared";

import {
	ensureBetterAuthReady,
	getBetterAuthHandler,
} from "../auth/better-auth.ts";
import { audit, getAuditRequestFields } from "../observability/audit.ts";
import { log } from "../observability/log.ts";
import { createRelayRouterContext } from "./context.ts";
import { createCorsHeaders } from "./http/cors.ts";
import { getErrorMessage, sendJson, sendText, setHeaders } from "./http/response.ts";
import { buildHealthPayload } from "./protocol/responses.ts";
import { createAgentAuthRouter } from "./routes/agent-auth.ts";
import { createClientAuthRouter } from "./routes/client-auth.ts";
import { createCredentialRouter } from "./routes/credentials.ts";
import { createTransportRouter } from "./routes/transport.ts";
import type { RelayServerState } from "./state.ts";
import { createRelayTransportHandlers } from "./transport/handlers.ts";

// Builds the Express application that owns relay HTTP routing and middleware.
export function createRelayRequestHandler(state: RelayServerState) {
	const app = express();
	const context = createRelayRouterContext(state);

	// Match the old Node response surface by avoiding Express's identifying header.
	app.disable("x-powered-by");

	// CORS applies consistently, while each known route decides how to answer OPTIONS.
	app.use((request, response, next) => {
		setHeaders(response, createCorsHeaders(request));
		next();
	});

	// Better Auth keeps ownership of its full path and raw Node request/response.
	app.all(/^\/api\/auth\/.*/, async (request, response) => {
		if (request.method === "OPTIONS") {
			response.status(204).end();
			return;
		}

		response.once("finish", () => {
			if (response.statusCode >= 400) {
				audit("authorization.failed", "failure", {
					...getAuditRequestFields(request),
					statusCode: response.statusCode,
					reason: "request_rejected",
					transport: "http",
				});
			}
		});
		try {
			await ensureBetterAuthReady();
			getBetterAuthHandler()(request, response);
		} catch (error) {
			const message = getErrorMessage(error);
			log("warn", "better auth unavailable", { error: message });
			sendJson(response, 503, { message });
		}
	});

	app.all(["/", "/health"], (request, response) => {
		sendJson(
			response,
			200,
			buildHealthPayload(createCorsHeaders(request), state.ownerBindingStore),
		);
	});

	app.use(createCredentialRouter(context));
	app.use(createClientAuthRouter(context));
	app.use(createAgentAuthRouter(context));
	app.use(createTransportRouter(context));

	app.use((_request, response) => {
		sendText(response, 404, "Not Found");
	});

	const handleUnexpectedError: ErrorRequestHandler = (error, request, response, next) => {
		const message = getErrorMessage(error);
		log("error", "unhandled relay request error", {
			error: message,
			...getAuditRequestFields(request),
		});
		if (response.headersSent) {
			next(error);
			return;
		}
		sendJson(response, 500, { message: "Internal Server Error" });
	};
	app.use(handleUnexpectedError);

	return app;
}

// WebSocket upgrades stay on the raw Node server because the transport layer
// owns heartbeat, pairing, and replacement behavior beyond ordinary routing.
export function createRelayUpgradeHandler(state: RelayServerState) {
	const transports = createRelayTransportHandlers(state);

	return (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
		if (pathname === CLIENT_EVENT_STREAM_PATH) {
			transports.handleBrowserClientWebSocketUpgrade(request, socket, head);
			return;
		}

		if (pathname === RELAY_AGENT_STREAM_PATH) {
			transports.handleAgentWebSocketUpgrade(request, socket, head);
			return;
		}

		log("warn", "relay websocket upgrade rejected for unknown path", { pathname });
		socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
		socket.destroy();
	};
}
