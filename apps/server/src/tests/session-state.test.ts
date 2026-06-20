import assert from "node:assert/strict";
import test from "node:test";

import {
	appendAssistantText,
	appendAssistantThinking,
	buildSessionPayload,
	createPendingAssistantMessage,
	createSharedSession,
	finalizeAssistantMessage,
	settleSession,
	updateAssistantToolCallStatus,
	upsertAssistantToolCall,
} from "../web/session-state.ts";

test("keeps streamed assistant segments ordered and tool state synchronized", () => {
	const session = createSharedSession("Investigate the production failure");
	session.busy = true;

	appendAssistantText(session, "The result", 2);
	upsertAssistantToolCall(session, {
		id: "tool-one",
		name: "inspect_logs",
		summary: "Inspecting logs",
		status: "running",
		contentIndex: 1,
	});
	appendAssistantThinking(session, "Check the logs first.", 0);
	appendAssistantText(session, " is ready.", 2);
	updateAssistantToolCallStatus(session, "tool-one", "completed");

	const pendingMessage = session.transcript[0];
	assert.ok(pendingMessage);
	assert.equal(pendingMessage.body, "The result is ready.");
	assert.equal(pendingMessage.thinking, "Check the logs first.");
	assert.deepEqual(
		pendingMessage.segments.map((segment) => [segment.type, segment.contentIndex]),
		[["thinking", 0], ["tool_call", 1], ["text", 2]],
	);
	assert.equal(pendingMessage.toolCalls[0]?.status, "completed");
	assert.equal(
		pendingMessage.segments.find((segment) => segment.type === "tool_call")?.status,
		"completed",
	);

	const payload = buildSessionPayload(session);
	payload.transcript[0]!.segments[0]!.updatedAt = 0;
	assert.notEqual(session.transcript[0]!.segments[0]!.updatedAt, 0);

	settleSession(session);
	assert.equal(session.busy, false);
	assert.equal(session.pendingAssistantMessageId, null);
	assert.equal(session.transcript[0]?.pending, false);
});

test("drops an empty pending assistant message when the stream ends", () => {
	const session = createSharedSession("Hello");
	createPendingAssistantMessage(session, "empty-assistant");

	finalizeAssistantMessage(session);

	assert.equal(session.pendingAssistantMessageId, null);
	assert.deepEqual(session.transcript, []);
});
