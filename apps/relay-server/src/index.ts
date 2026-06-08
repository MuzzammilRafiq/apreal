import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRelayEnv } from "./env.ts";
import { createRelayRequestHandler } from "./relay/routes.ts";
import { createRelayServerState } from "./relay/state.ts";
import { log } from "./utils/log.ts";

export function runRelayServer(options?: { port?: number | string }) {
	const state = createRelayServerState();
	const port = options?.port ?? getRelayEnv().PORT;
	const server = createServer(createRelayRequestHandler(state));

	server.listen(port);

	log("info", "relay server listening", {
		port,
		transport: "http",
		tokenStorePath: state.tokenStore.getFilePath(),
		tokenCount: state.tokenStore.countTokens({ allowExpired: true }),
	});

	return server;
}

const isDirectEntrypoint = process.argv[1]
	? fileURLToPath(import.meta.url) === resolve(process.argv[1])
	: false;

if (isDirectEntrypoint) {
	runRelayServer();
}
