import { summarizePrompt } from "./logger.ts";
import type { AgentContextUsage, AgentController, AgentStreamEvent } from "./session.ts";

export type TranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "error";
	body: string;
	thinking: string;
	toolCalls: TranscriptToolCall[];
	segments: TranscriptMessageSegment[];
	pending: boolean;
	createdAt: number;
};

export type TranscriptToolCall = {
	id: string;
	name: string;
	summary: string;
	status: "running" | "completed" | "failed";
	createdAt: number;
	updatedAt: number;
};

export type TranscriptThinkingSegment = {
	id: string;
	type: "thinking";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

export type TranscriptTextSegment = {
	id: string;
	type: "text";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

export type TranscriptToolCallSegment = TranscriptToolCall & {
	type: "tool_call";
	contentIndex?: number;
};

export type TranscriptMessageSegment =
	| TranscriptTextSegment
	| TranscriptThinkingSegment
	| TranscriptToolCallSegment;

export type SharedSessionState = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	abortRequested: boolean;
	model: string | null;
	controller: AgentController | null;
	controllerPromise: Promise<AgentController> | null;
	unsubscribe: (() => void) | null;
	transcript: TranscriptMessage[];
	pendingAssistantMessageId: string | null;
	toolCallMessageIds: Map<string, string>;
};

export type SessionSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
	contextUsage: AgentContextUsage | null;
};

function createSessionTitle(prompt: string): string {
	return summarizePrompt(prompt, 42) || "New chat";
}

function createSessionPreview(transcript: TranscriptMessage[]): string {
	for (let index = transcript.length - 1; index >= 0; index -= 1) {
		const entry = transcript[index];
		if (!entry) {
			continue;
		}

		const body = entry.body.trim();
		if (!body) {
			continue;
		}

		return summarizePrompt(body, 72);
	}

	return "No messages yet";
}

export function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
		segments: entry.segments.map((segment) => ({ ...segment })),
	}));
}

export function buildSessionSummary(session: SharedSessionState): SessionSummary {
	const contextUsage = session.controller?.getContextUsage() ?? null;

	return {
		id: session.id,
		title: session.title,
		preview: createSessionPreview(session.transcript),
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		busy: session.busy,
		model: session.model,
		messageCount: session.transcript.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
		contextUsage,
	};
}

export function buildSessionPayload(session: SharedSessionState) {
	return {
		session: buildSessionSummary(session),
		transcript: cloneTranscript(session.transcript),
	};
}

export function touchSession(session: SharedSessionState) {
	session.updatedAt = Date.now();
}

export function appendTranscriptMessage(
	session: SharedSessionState,
	message: Omit<TranscriptMessage, "createdAt">,
) {
	session.transcript.push({
		...message,
		thinking: message.thinking ?? "",
		toolCalls: message.toolCalls ? message.toolCalls.map((toolCall) => ({ ...toolCall })) : [],
		segments: message.segments ? message.segments.map((segment) => ({ ...segment })) : [],
		createdAt: Date.now(),
	});
	touchSession(session);
}

export function createPendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
	const message: TranscriptMessage = {
		id: crypto.randomUUID(),
		role: "assistant",
		body: "",
		thinking: "",
		toolCalls: [],
		segments: [],
		pending: true,
		createdAt: Date.now(),
	};
	session.pendingAssistantMessageId = message.id;
	session.transcript.push(message);
	touchSession(session);
	return message;
}

export function getPendingAssistantMessage(session: SharedSessionState): TranscriptMessage | null {
	if (!session.pendingAssistantMessageId) {
		return null;
	}

	const message = session.transcript.find((entry) => entry.id === session.pendingAssistantMessageId);
	if (!message) {
		session.pendingAssistantMessageId = null;
		return null;
	}

	return message;
}

export function finalizeAssistantMessage(session: SharedSessionState) {
	const message = getPendingAssistantMessage(session);
	if (!message) {
		return;
	}

	message.pending = false;
	if (!message.body.trim() && !message.thinking.trim() && message.toolCalls.length === 0) {
		session.transcript = session.transcript.filter((entry) => entry.id !== message.id);
	}

	session.pendingAssistantMessageId = null;
	touchSession(session);
}

export function settleSession(session: SharedSessionState) {
	finalizeAssistantMessage(session);
	session.busy = false;
	session.abortRequested = false;
	touchSession(session);
}

export function createSharedSession(initialPrompt: string): SharedSessionState {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		title: createSessionTitle(initialPrompt),
		createdAt: now,
		updatedAt: now,
		busy: false,
		abortRequested: false,
		model: null,
		controller: null,
		controllerPromise: null,
		unsubscribe: null,
		transcript: [],
		pendingAssistantMessageId: null,
		toolCallMessageIds: new Map(),
	};
}

function ensurePendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
	return getPendingAssistantMessage(session) ?? createPendingAssistantMessage(session);
}

function findTranscriptMessage(session: SharedSessionState, messageId: string): TranscriptMessage | null {
	return session.transcript.find((entry) => entry.id === messageId) ?? null;
}

function getSegmentSortValue(segment: TranscriptMessageSegment): number {
	return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

function insertAssistantSegment(message: TranscriptMessage, segment: TranscriptMessageSegment) {
	const insertIndex = message.segments.findIndex(
		(existing) => getSegmentSortValue(existing) > getSegmentSortValue(segment),
	);
	if (insertIndex === -1) {
		message.segments.push(segment);
		return;
	}

	message.segments.splice(insertIndex, 0, segment);
}

export function appendAssistantText(
	session: SharedSessionState,
	delta: string,
	contentIndex?: number,
): TranscriptMessage {
	const message = ensurePendingAssistantMessage(session);
	const now = Date.now();
	message.body += delta;
	const existingSegment = message.segments.find(
		(entry): entry is TranscriptTextSegment =>
			entry.type === "text" &&
			(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
	);
	if (existingSegment) {
		existingSegment.content += delta;
		existingSegment.updatedAt = now;
	} else {
		insertAssistantSegment(message, {
			id: crypto.randomUUID(),
			type: "text",
			content: delta,
			contentIndex,
			createdAt: now,
			updatedAt: now,
		});
	}
	touchSession(session);
	return message;
}

export function appendAssistantThinking(
	session: SharedSessionState,
	delta: string,
	contentIndex?: number,
): TranscriptMessage {
	const message = ensurePendingAssistantMessage(session);
	const now = Date.now();
	message.thinking += delta;
	const existingSegment = message.segments.find(
		(entry): entry is TranscriptThinkingSegment =>
			entry.type === "thinking" &&
			(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
	);
	if (existingSegment) {
		existingSegment.content += delta;
		existingSegment.updatedAt = now;
	} else {
		insertAssistantSegment(message, {
			id: crypto.randomUUID(),
			type: "thinking",
			content: delta,
			contentIndex,
			createdAt: now,
			updatedAt: now,
		});
	}
	touchSession(session);
	return message;
}

export function upsertAssistantToolCall(
	session: SharedSessionState,
	toolCall: Omit<TranscriptToolCall, "createdAt" | "updatedAt"> & { contentIndex?: number },
): TranscriptMessage {
	const message = ensurePendingAssistantMessage(session);
	const now = Date.now();
	const existing = message.toolCalls.find((entry) => entry.id === toolCall.id);
	if (existing) {
		existing.name = toolCall.name;
		existing.summary = toolCall.summary;
		existing.status = toolCall.status;
		existing.updatedAt = now;
	} else {
		message.toolCalls.push({
			...toolCall,
			createdAt: now,
			updatedAt: now,
		});
	}

	const existingSegment = message.segments.find(
		(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCall.id,
	);
	if (existingSegment) {
		existingSegment.name = toolCall.name;
		existingSegment.summary = toolCall.summary;
		existingSegment.status = toolCall.status;
		existingSegment.contentIndex = toolCall.contentIndex ?? existingSegment.contentIndex;
		existingSegment.updatedAt = now;
	} else {
		insertAssistantSegment(message, {
			...toolCall,
			type: "tool_call",
			contentIndex: toolCall.contentIndex,
			createdAt: now,
			updatedAt: now,
		});
	}

	session.toolCallMessageIds.set(toolCall.id, message.id);
	touchSession(session);
	return message;
}

export function updateAssistantToolCallStatus(
	session: SharedSessionState,
	toolCallId: string,
	status: TranscriptToolCall["status"],
) {
	const ownerMessageId = session.toolCallMessageIds.get(toolCallId);
	const message = ownerMessageId ? findTranscriptMessage(session, ownerMessageId) : getPendingAssistantMessage(session);
	if (!message) {
		return;
	}

	const toolCall = message.toolCalls.find((entry) => entry.id === toolCallId);
	if (!toolCall) {
		return;
	}

	toolCall.status = status;
	toolCall.updatedAt = Date.now();
	const toolSegment = message.segments.find(
		(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCallId,
	);
	if (toolSegment) {
		toolSegment.status = status;
		toolSegment.updatedAt = toolCall.updatedAt;
	}
	touchSession(session);
}

export function failRunningAssistantToolCalls(session: SharedSessionState) {
	let changed = false;
	for (const message of session.transcript) {
		for (const toolCall of message.toolCalls) {
			if (toolCall.status === "running") {
				toolCall.status = "failed";
				toolCall.updatedAt = Date.now();
				changed = true;
			}
		}

		for (const segment of message.segments) {
			if (segment.type === "tool_call" && segment.status === "running") {
				segment.status = "failed";
				segment.updatedAt = Date.now();
				changed = true;
			}
		}
	}

	if (changed) {
		touchSession(session);
	}
}

export function applyAssistantMessageSnapshot(
	session: SharedSessionState,
	snapshot: Extract<AgentStreamEvent, { type: "message_end" }>,
): TranscriptMessage {
	const message = ensurePendingAssistantMessage(session);
	const now = Date.now();
	message.body =
		snapshot.stopReason === "error" && snapshot.errorMessage && !snapshot.body.trim()
			? `Error: ${snapshot.errorMessage}`
			: snapshot.body;
	message.thinking = snapshot.thinking;
	const existingToolCalls = new Map(message.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
	message.toolCalls = snapshot.toolCalls.map((toolCall) => {
		const existingToolCall = existingToolCalls.get(toolCall.id);
		return {
			id: toolCall.id,
			name: toolCall.name,
			summary: toolCall.summary,
			status: toolCall.status,
			createdAt: existingToolCall?.createdAt ?? now,
			updatedAt: now,
		};
	});

	if (snapshot.segments.length > 0) {
		const existingTextSegments = new Map(
			message.segments
				.filter((segment): segment is TranscriptTextSegment => segment.type === "text")
				.map((segment) => [segment.contentIndex ?? -1, segment]),
		);
		const existingThinkingSegments = new Map(
			message.segments
				.filter((segment): segment is TranscriptThinkingSegment => segment.type === "thinking")
				.map((segment) => [segment.contentIndex ?? -1, segment]),
		);
		const existingToolSegments = new Map(
			message.segments
				.filter((segment): segment is TranscriptToolCallSegment => segment.type === "tool_call")
				.map((segment) => [segment.id, segment]),
		);

		message.segments = snapshot.segments.map((segment) => {
			switch (segment.type) {
				case "text": {
					const existingSegment = existingTextSegments.get(segment.contentIndex);
					return {
						id: existingSegment?.id ?? crypto.randomUUID(),
						type: "text",
						content: segment.content,
						contentIndex: segment.contentIndex,
						createdAt: existingSegment?.createdAt ?? now,
						updatedAt: now,
					};
				}
				case "thinking": {
					const existingSegment = existingThinkingSegments.get(segment.contentIndex);
					return {
						id: existingSegment?.id ?? crypto.randomUUID(),
						type: "thinking",
						content: segment.content,
						contentIndex: segment.contentIndex,
						createdAt: existingSegment?.createdAt ?? now,
						updatedAt: now,
					};
				}
				case "tool_call": {
					const existingSegment = existingToolSegments.get(segment.id);
					return {
						id: segment.id,
						name: segment.name,
						summary: segment.summary,
						status: segment.status,
						type: "tool_call",
						contentIndex: segment.contentIndex,
						createdAt: existingSegment?.createdAt ?? now,
						updatedAt: now,
					};
				}
			}
		});
	}

	for (const toolCall of message.toolCalls) {
		if (message.segments.some((segment) => segment.type === "tool_call" && segment.id === toolCall.id)) {
			continue;
		}

		insertAssistantSegment(message, {
			...toolCall,
			type: "tool_call",
			createdAt: toolCall.createdAt,
			updatedAt: toolCall.updatedAt,
		});
	}

	touchSession(session);
	return message;
}