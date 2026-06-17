import type {
	ClientJobsCommand,
	ClientMcpCommand,
	ClientProvidersCommand,
	ClientStatusCommand,
	ServerJobsMessage,
	ServerMcpMessage,
	ServerProvidersMessage,
	ServerStatusMessage,
	ServerSyncEnvelope,
} from "@apreal/shared";
import type { SessionCacheEntry, SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "./chatTypes";
import { createBrowserUuid } from "./local-client";

export const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
export const SESSION_PAGE_SIZE = 50;
export const STREAM_DISCONNECTED_MESSAGE = "Disconnected from the server stream. Reconnecting...";
export const STREAM_REQUIRED_MESSAGE = "Client event stream is not connected.";
export const RELAY_STREAM_REQUIRED_MESSAGE = "browser client stream is not connected";
export const LOCAL_ADMIN_STATUS_REFRESH_INTERVAL_MS = 3_000;
export const RELAY_STATUS_REFRESH_INTERVAL_MS = 15_000;

export type AppRoute = "chat" | "settings" | "jobs";

export type ClientMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "delete_session"; sessionId: string }
	| { type: "delete_all_sessions" }
	| { type: "load_session"; sessionId: string; knownRevision?: number }
	| { type: "load_sessions_page"; offset?: number; limit?: number }
	| { type: "ping" }
	| ClientJobsCommand
	| ClientProvidersCommand
	| ClientStatusCommand
	| ClientMcpCommand;

export type ServerPayload =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "disconnected"; reason: string; message: string }
	| { type: "sessions_page"; sessions: SessionSummary[]; offset: number; limit: number; total: number }
	| { type: "session_summary_updated"; session: SessionSummary }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_deleted"; sessionId: string }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" }
	| ServerJobsMessage
	| ServerProvidersMessage
	| ServerStatusMessage
	| ServerMcpMessage;

export type ServerMessage = ServerPayload | ServerSyncEnvelope<ServerPayload>;

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

export function readSelectedJobIdFromRoute(): string | null {
	if (window.location.pathname !== "/jobs") {
		return null;
	}

	const jobId = new URLSearchParams(window.location.search).get("job");
	return jobId && jobId.trim().length > 0 ? jobId : null;
}

export function navigateToRoute(route: AppRoute, options: { jobId?: string | null } = {}) {
	const nextPathname = route === "settings" ? "/settings" : route === "jobs" ? "/jobs" : "/";
	const nextUrl = new URL(window.location.href);
	nextUrl.pathname = nextPathname;
	nextUrl.search = "";
	if (route === "jobs" && options.jobId) {
		nextUrl.searchParams.set("job", options.jobId);
	}

	if (`${window.location.pathname}${window.location.search}` === `${nextUrl.pathname}${nextUrl.search}`) {
		return;
	}

	window.history.pushState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function isClientStreamRequiredError(error: unknown): boolean {
	const message = getErrorMessage(error).trim().replace(/\.$/, "").toLowerCase();
	return message === STREAM_REQUIRED_MESSAGE.replace(/\.$/, "").toLowerCase() ||
		message === RELAY_STREAM_REQUIRED_MESSAGE;
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
		transcriptRevision: null,
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
			id: createBrowserUuid(),
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
