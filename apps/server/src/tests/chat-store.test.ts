import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createChatStore } from "../chat-store.ts";
import { buildSessionSummary, createSharedSession } from "../web/session-state.ts";

test("chat store loads summaries without transcripts and preserves order when hydrated", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "apreal-chat-store-"));
	try {
		const store = createChatStore(join(tempDir, "chat.sqlite"));
		assert.equal(store.getStatus().enabled, true);

		const session = createSharedSession("hello");
		const createdAt = 1234567890;
		session.transcript = [
			{
				id: "prompt-1:user",
				role: "user",
				body: "hello",
				thinking: "",
				modelLabel: null,
				modelSource: null,
				toolCalls: [],
				segments: [],
				pending: false,
				createdAt,
			},
			{
				id: "prompt-1:assistant",
				role: "assistant",
				body: "Hi there!",
				thinking: "",
				modelLabel: null,
				modelSource: null,
				toolCalls: [],
				segments: [],
				pending: false,
				createdAt,
			},
		];

		store.saveSession(session);

		const loaded = store.loadSessionSummaries().get(session.id);
		assert.ok(loaded);
		assert.equal(loaded.transcriptLoaded, false);
		assert.equal(loaded.transcript.length, 0);
		assert.equal(loaded.persistedPreview, "Hi there!");
		assert.equal(loaded.persistedMessageCount, 2);
		assert.deepEqual(
			{ preview: buildSessionSummary(loaded).preview, messageCount: buildSessionSummary(loaded).messageCount },
			{ preview: "Hi there!", messageCount: 2 },
		);
		assert.equal(store.loadSession(loaded), true);
		assert.deepEqual(
			loaded.transcript.map((message) => message.id),
			["prompt-1:user", "prompt-1:assistant"],
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
