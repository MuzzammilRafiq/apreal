import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRelayEnv } from "./env.ts";
import { createRelayRequestHandler } from "./relay/routes.ts";
import { createRelayServerState } from "./relay/state.ts";
import { log } from "./utils/log.ts";

// Bootstraps the relay's shared state, attaches the request router, and starts
// listening on the configured HTTP port.
export function runRelayServer(options?: { port?: number | string }) {
	const state = createRelayServerState();
	const port = options?.port ?? getRelayEnv().PORT;
	const server = createServer(createRelayRequestHandler(state));

	server.listen(port);

	log("info", "relay server listening", {
		port,
		transport: "http",
		ownerBindingStorePath: state.ownerBindingStore.getFilePath(),
		ownerBindingCount: state.ownerBindingStore.countBindings(),
	});

	return server;
}

// Detects whether this file was executed directly so imports from tests or
// scripts do not accidentally start a long-running relay process.
const isDirectEntrypoint = process.argv[1]
	? fileURLToPath(import.meta.url) === resolve(process.argv[1])
	: false;

if (isDirectEntrypoint) {
	runRelayServer();
}
