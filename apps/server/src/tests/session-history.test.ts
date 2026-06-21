import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentHistory } from "../session.ts";

test("buildAgentHistory preserves prior user and assistant turns for a replacement controller", () => {
	const messages = buildAgentHistory([
		{ role: "user", body: "My project is called Apreal.", createdAt: 100 },
		{ role: "assistant", body: "Got it.", createdAt: 200 },
		{ role: "assistant", body: "   ", createdAt: 300 },
	], {
		api: "openai-responses",
		provider: "openai",
		id: "gpt-test",
	});

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], {
		role: "user",
		content: "My project is called Apreal.",
		timestamp: 100,
	});
	assert.deepEqual(messages[1], {
		role: "assistant",
		content: [{ type: "text", text: "Got it." }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 200,
	});
});
