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

export type TranscriptMessageSegment = TranscriptTextSegment | TranscriptThinkingSegment | TranscriptToolCallSegment;

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
	revision: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
	contextUsage: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	} | null;
};

export type SessionCacheEntry = {
	session: SessionSummary;
	transcript: TranscriptMessage[];
	transcriptLoaded: boolean;
};

export type ScheduledJobDetails = {
	id: string;
	name: string;
	prompt: string;
	intervalMs: number;
	enabled: boolean;
	lastRunAt: number | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
	runCount: number;
	maxCatchup: number;
	lastError: string | null;
};
