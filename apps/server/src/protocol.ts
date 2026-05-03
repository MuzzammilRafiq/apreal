export type ClientAppMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "delete_session"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "load_sessions_page"; offset?: number; limit?: number }
	| { type: "ping" };

export type ServerAppMessage<SessionSummary, TranscriptMessage> =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "sessions_page"; sessions: SessionSummary[]; offset: number; limit: number; total: number }
	| { type: "session_summary_updated"; session: SessionSummary }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_deleted"; sessionId: string }
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

	if (value.type === "delete_session" && typeof value.sessionId === "string") {
		return { type: "delete_session", sessionId: value.sessionId };
	}

	if (value.type === "load_session" && typeof value.sessionId === "string") {
		return { type: "load_session", sessionId: value.sessionId };
	}

	if (value.type === "load_sessions_page") {
		return {
			type: "load_sessions_page",
			offset: typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : 0,
			limit: typeof value.limit === "number" && Number.isInteger(value.limit) && value.limit > 0 ? value.limit : undefined,
		};
	}

	if (value.type === "ping") {
		return { type: "ping" };
	}

	return null;
}
