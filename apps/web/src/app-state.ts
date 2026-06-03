import type { SessionCacheEntry, SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "./chatTypes";
import { getWebTransportConfig } from "./transport-config";

export const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
export const SESSION_PAGE_SIZE = 50;
export const STREAM_DISCONNECTED_MESSAGE = "Disconnected from the server stream. Reconnecting...";
export const STREAM_REQUIRED_MESSAGE = "Client event stream is not connected.";
export const ADMIN_STATUS_REFRESH_INTERVAL_MS = 3_000;
export const transportConfig = getWebTransportConfig();

export type AppRoute = "chat" | "settings" | "jobs";

export type ClientMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "load_sessions_page"; offset?: number; limit?: number }
	| { type: "ping" };

export type ServerMessage =
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

export type AssistantDeltaField = "body" | "thinking";

export function readCurrentRoute(): AppRoute {
	if (window.location.pathname === "/settings") {
		return "settings";
	}

	if (window.location.pathname === "/jobs") {
		return "jobs";
	}

	return "chat";
}

export function navigateToRoute(route: AppRoute) {
	const nextPathname = route === "settings" ? "/settings" : route === "jobs" ? "/jobs" : "/";
	if (window.location.pathname === nextPathname) {
		return;
	}

	window.history.pushState({}, "", nextPathname);
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStoredSessionId(): string | null {
	try {
		return window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function storeActiveSessionId(sessionId: string | null) {
	try {
		if (sessionId) {
			window.sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
			return;
		}

		window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
	} catch {
		// Ignore browser storage failures.
	}
}

export function parseServerMessage(rawData: string): ServerMessage | null {
	let value: unknown;
	try {
		value = JSON.parse(rawData);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.type !== "string") {
		return null;
	}

	return value as ServerMessage;
}

export function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		modelLabel: entry.modelLabel ?? null,
		modelSource: entry.modelSource ?? null,
		toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
		segments: entry.segments.map((segment) => ({ ...segment })),
	}));
}

export function upsertSessionInList(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
	const next = sessions.filter((entry) => entry.id !== session.id);
	next.push(session);
	next.sort((left, right) => right.updatedAt - left.updatedAt);
	return next;
}

export function isScheduledSessionSummary(session: SessionSummary | null | undefined): boolean {
	return Boolean(session?.title.startsWith("[Scheduled:"));
}

export function createSummaryOnlyCacheEntry(session: SessionSummary): SessionCacheEntry {
	return {
		session,
		transcript: [],
		transcriptLoaded: false,
	};
}

export function getSegmentSortValue(segment: TranscriptMessageSegment): number {
	return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

export function insertSegmentInOrder(
	segments: TranscriptMessageSegment[],
	segment: TranscriptMessageSegment,
): TranscriptMessageSegment[] {
	const next = [...segments];
	const insertIndex = next.findIndex((entry) => getSegmentSortValue(entry) > getSegmentSortValue(segment));
	if (insertIndex === -1) {
		next.push(segment);
		return next;
	}

	next.splice(insertIndex, 0, segment);
	return next;
}

export function appendAssistantDeltaToMessage(
	message: TranscriptMessage,
	delta: string,
	field: AssistantDeltaField,
	contentIndex: number,
): TranscriptMessage {
	const now = Date.now();
	const segmentType = field === "thinking" ? "thinking" : "text";
	const existingSegmentIndex = message.segments.findIndex(
		(segment) => segment.type === segmentType && segment.contentIndex === contentIndex,
	);

	let segments = message.segments;
	if (existingSegmentIndex >= 0) {
		segments = [...message.segments];
		const existingSegment = segments[existingSegmentIndex];
		if (existingSegment && existingSegment.type === segmentType) {
			segments[existingSegmentIndex] = {
				...existingSegment,
				content: `${existingSegment.content}${delta}`,
				updatedAt: now,
			};
		}
	} else {
		segments = insertSegmentInOrder(message.segments, {
			id: crypto.randomUUID(),
			type: segmentType,
			content: delta,
			contentIndex,
			createdAt: now,
			updatedAt: now,
		} as TranscriptMessageSegment);
	}

	if (field === "thinking") {
		return {
			...message,
			pending: true,
			thinking: `${message.thinking}${delta}`,
			segments,
		};
	}

	return {
		...message,
		pending: true,
		body: `${message.body}${delta}`,
		segments,
	};
}
