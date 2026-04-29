export type ClientAppMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "ping" };

export type ServerAppMessage<SessionSummary, TranscriptMessage> =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "sessions_updated"; sessions: SessionSummary[] }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" };

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRawMessage(rawMessage: string | Buffer | unknown): unknown {
	if (typeof rawMessage === "string") {
		return JSON.parse(rawMessage);
	}

	if (typeof Buffer !== "undefined" && rawMessage instanceof Buffer) {
		return JSON.parse(rawMessage.toString());
	}

	return rawMessage;
}

export function parseClientAppMessage(rawMessage: string | Buffer | unknown): ClientAppMessage | null {
	let value: unknown;
	try {
		value = normalizeRawMessage(rawMessage);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.type !== "string") {
		return null;
	}

	if (value.type === "prompt" && typeof value.prompt === "string") {
		return {
			type: "prompt",
			prompt: value.prompt,
			sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
		};
	}

	if (value.type === "abort" && typeof value.sessionId === "string") {
		return { type: "abort", sessionId: value.sessionId };
	}

	if (value.type === "load_session" && typeof value.sessionId === "string") {
		return { type: "load_session", sessionId: value.sessionId };
	}

	if (value.type === "ping") {
		return { type: "ping" };
	}

	return null;
}
