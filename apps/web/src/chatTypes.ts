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
	createdAt: number;
	updatedAt: number;
};

export type TranscriptToolCallSegment = TranscriptToolCall & {
	type: "tool_call";
};

export type TranscriptMessageSegment = TranscriptThinkingSegment | TranscriptToolCallSegment;

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

export type SessionSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
};

export type SessionCacheEntry = {
	session: SessionSummary;
	transcript: TranscriptMessage[];
};
