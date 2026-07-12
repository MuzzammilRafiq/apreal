import assert from "node:assert/strict";
import test from "node:test";

import { createClientManager } from "../web/client-manager.ts";
import type { ServerMessage } from "../util/utils.ts";

function createLogger() {
	return {
		debug() {},
		info() {},
		warn() {},
		error() {},
	};
}

test("replay reset is sent when the client cursor is ahead of reset server state", () => {
	const sent: ServerMessage[] = [];
	const manager = createClientManager({
		logger: createLogger(),
		clients: new Map(),
		sessions: new Map(),
	});

	const client = manager.registerClientConnection("client-reset", "http", (payload) => {
		sent.push(payload);
		return true;
	});
	client.ready = true;

	manager.replayClientSyncEvents("client-reset", 42);

	assert.deepEqual(sent, [{
		type: "replay_reset",
		reason: "replay_unavailable",
		lastSeq: 42,
		nextSeq: 1,
	}]);
});
