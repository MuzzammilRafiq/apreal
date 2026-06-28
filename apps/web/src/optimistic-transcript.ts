import type { TranscriptMessage } from "./chatTypes";

export type PendingPrompt = {
	id: string;
	prompt: string;
	sessionId: string | null;
};

export function createOptimisticTranscript(
	transcript: TranscriptMessage[],
	pendingPrompt: PendingPrompt | null,
): TranscriptMessage[] {
	if (!pendingPrompt) {
		return transcript;
	}

	const now = Date.now();
	return [
		...transcript,
		{
			id: `${pendingPrompt.id}:user`,
			role: "user",
			body: pendingPrompt.prompt,
			thinking: "",
			modelLabel: null,
			modelSource: null,
			toolCalls: [],
			segments: [],
			pending: true,
			createdAt: now,
		},
		{
			id: `${pendingPrompt.id}:assistant`,
			role: "assistant",
			body: "",
			thinking: "",
			modelLabel: null,
			modelSource: null,
			toolCalls: [],
			segments: [],
			pending: true,
			createdAt: now,
		},
	];
}

export function transcriptContainsPrompt(transcript: TranscriptMessage[], prompt: string): boolean {
	return transcript.some((message) => message.role === "user" && message.body.trim() === prompt);
}
