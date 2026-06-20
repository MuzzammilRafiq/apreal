import assert from "node:assert/strict";
import test from "node:test";

import {
	appendAssistantDeltaToMessage,
	cloneTranscript,
	insertSegmentInOrder,
} from "../app-state.ts";
import type { TranscriptMessage, TranscriptMessageSegment } from "../chatTypes.ts";

function createAssistantMessage(): TranscriptMessage {
	return {
		id: "assistant-one",
		role: "assistant",
		body: "",
		thinking: "",
		modelLabel: "Test model",
		modelSource: "test",
		toolCalls: [],
		segments: [],
		pending: false,
		createdAt: 100,
	};
}

test("assembles interleaved assistant deltas into ordered transcript segments", () => {
	const original = createAssistantMessage();
	const withText = appendAssistantDeltaToMessage(original, "The result", "body", 2);
	const withThinking = appendAssistantDeltaToMessage(withText, "Check first.", "thinking", 0);
	const complete = appendAssistantDeltaToMessage(withThinking, " is ready.", "body", 2);

	assert.equal(original.body, "");
	assert.equal(complete.body, "The result is ready.");
	assert.equal(complete.thinking, "Check first.");
	assert.equal(complete.pending, true);
	assert.deepEqual(
		complete.segments.map((segment) => [
			segment.type,
			segment.contentIndex,
			segment.type === "tool_call" ? segment.summary : segment.content,
		]),
		[
			["thinking", 0, "Check first."],
			["text", 2, "The result is ready."],
		],
	);
});

test("preserves stable ordering for segments sharing a content index", () => {
	const first: TranscriptMessageSegment = {
		id: "first",
		type: "text",
		content: "first",
		contentIndex: 1,
		createdAt: 1,
		updatedAt: 1,
	};
	const second: TranscriptMessageSegment = {
		id: "second",
		type: "thinking",
		content: "second",
		contentIndex: 1,
		createdAt: 2,
		updatedAt: 2,
	};

	assert.deepEqual(insertSegmentInOrder([first], second).map((segment) => segment.id), ["first", "second"]);
});

test("clones mutable transcript children before caching UI state", () => {
	const message = createAssistantMessage();
	message.toolCalls.push({
		id: "tool-one",
		name: "search",
		summary: "Searching",
		status: "running",
		createdAt: 1,
		updatedAt: 1,
	});
	message.segments.push({ ...message.toolCalls[0]!, type: "tool_call", contentIndex: 0 });

	const cloned = cloneTranscript([message]);
	cloned[0]!.toolCalls[0]!.status = "completed";
	cloned[0]!.segments[0]!.updatedAt = 2;

	assert.equal(message.toolCalls[0]?.status, "running");
	assert.equal(message.segments[0]?.updatedAt, 1);
});
