import assert from "node:assert/strict";
import test from "node:test";
import { parseServerMessage } from "../app-state";

test("parses server sync envelopes for reconnect replay", () => {
	const message = parseServerMessage(JSON.stringify({
		type: "sync_event",
		seq: 7,
		scope: "session:abc",
		emittedAt: 123,
		payload: {
			type: "assistant_delta",
			sessionId: "abc",
			messageId: "msg",
			delta: "hello",
			contentIndex: 0,
		},
	}));

	assert.equal(message?.type, "sync_event");
	if (message?.type === "sync_event") {
		assert.equal(message.seq, 7);
		assert.equal(message.payload.type, "assistant_delta");
	}
});

test("rejects malformed server messages", () => {
	assert.equal(parseServerMessage("not-json"), null);
	assert.equal(parseServerMessage(JSON.stringify({ seq: 1, payload: { type: "pong" } })), null);
	assert.equal(parseServerMessage(JSON.stringify({ type: "sync_event", seq: -1, scope: "global", emittedAt: 1, payload: { type: "pong" } })), null);
});
