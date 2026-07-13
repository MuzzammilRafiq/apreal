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

test("coalesces adjacent relay assistant deltas before sending", async () => {
	const sent: ServerMessage[] = [];
	const manager = createClientManager({
		logger: createLogger(),
		clients: new Map(),
		sessions: new Map(),
	});

	const client = manager.registerClientConnection("client-relay", "relay", (payload) => {
		sent.push(payload);
		return true;
	});
	client.ready = true;
	client.loadedSessionIds.add("session-1");

	manager.broadcastSessionPayload("session-1", {
		type: "assistant_delta",
		sessionId: "session-1",
		messageId: "message-1",
		delta: "hello",
		contentIndex: 0,
	});
	manager.broadcastSessionPayload("session-1", {
		type: "assistant_delta",
		sessionId: "session-1",
		messageId: "message-1",
		delta: " world",
		contentIndex: 0,
	});

	assert.equal(sent.length, 0);
	await new Promise((resolve) => setTimeout(resolve, 75));
	assert.equal(sent.length, 1);
	assert.equal(sent[0]?.type, "sync_event");
	if (sent[0]?.type === "sync_event") {
		assert.deepEqual(sent[0].payload, {
			type: "assistant_delta",
			sessionId: "session-1",
			messageId: "message-1",
			delta: "hello world",
			contentIndex: 0,
		});
	}
});

test("flushes buffered relay deltas before a following snapshot", () => {
	const sent: ServerMessage[] = [];
	const manager = createClientManager({
		logger: createLogger(),
		clients: new Map(),
		sessions: new Map(),
	});

	const client = manager.registerClientConnection("client-order", "relay", (payload) => {
		sent.push(payload);
		return true;
	});
	client.ready = true;
	client.loadedSessionIds.add("session-1");

	manager.broadcastSessionPayload("session-1", {
		type: "assistant_delta",
		sessionId: "session-1",
		messageId: "message-1",
		delta: "hello",
		contentIndex: 0,
	});
	manager.broadcastSessionPayload("session-1", {
		type: "session_snapshot",
		session: {
			id: "session-1",
			title: "Test",
			preview: "Test",
			busy: false,
			createdAt: 1,
			updatedAt: 1,
			revision: 1,
			model: "test",
			messageCount: 0,
			contextUsage: null,
		},
		transcript: [],
	});

	assert.equal(sent.length, 2);
	assert.equal(sent[0]?.type === "sync_event" ? sent[0].payload.type : null, "assistant_delta");
	assert.equal(sent[1]?.type === "sync_event" ? sent[1].payload.type : null, "session_snapshot");
});
