import type { RelayPairingStateMessage } from "@apreal/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { SessionCacheEntry, SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "./chatTypes";
import { formatSessionState } from "./chatView";
import { getWebTransportConfig } from "./transport-config";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
const STREAM_DISCONNECTED_MESSAGE = "Disconnected from the server stream. Reconnecting...";
const transportConfig = getWebTransportConfig();

type ClientMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "ping" };

type ServerMessage =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "sessions_updated"; sessions: SessionSummary[] }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" };

type AssistantDeltaField = "body" | "thinking";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredSessionId(): string | null {
	try {
		return window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

function storeActiveSessionId(sessionId: string | null) {
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

function parseServerMessage(rawData: string): ServerMessage | null {
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

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
		segments: entry.segments.map((segment) => ({ ...segment })),
	}));
}

function upsertSessionInList(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
	const next = sessions.filter((entry) => entry.id !== session.id);
	next.push(session);
	next.sort((left, right) => right.updatedAt - left.updatedAt);
	return next;
}

function getSegmentSortValue(segment: TranscriptMessageSegment): number {
	return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

function insertSegmentInOrder(
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

function appendAssistantDeltaToMessage(
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

export function App() {
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [relayError, setRelayError] = useState<string | null>(null);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const sessionCacheRef = useRef(sessionCache);
	const activeSessionIdRef = useRef(activeSessionId);
	const pairingState: RelayPairingStateMessage | null = null;

	useEffect(() => {
		sessionCacheRef.current = sessionCache;
	}, [sessionCache]);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
	const activeTranscript = activeSessionId ? sessionCache.get(activeSessionId)?.transcript ?? [] : [];
	const isBusy = pendingDraft || Boolean(activeSession?.busy);

	const focusPrompt = useCallback(() => {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}, []);

	const sendClientMessage = useCallback(async (message: ClientMessage) => {
		const response = await fetch(transportConfig.messageUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(message),
		});

		if (response.ok) {
			return;
		}

		let errorMessage = `request failed with status ${response.status}`;
		try {
			const payload: unknown = await response.json();
			if (isObjectRecord(payload) && typeof payload.message === "string") {
				errorMessage = payload.message;
			}
		} catch {
			// Ignore malformed error bodies.
		}

		throw new Error(errorMessage);
	}, []);

	const requestSessionSnapshot = useCallback((sessionId: string | null) => {
		if (!sessionId) {
			return;
		}

		void sendClientMessage({ type: "load_session", sessionId }).catch((error) => {
			setRelayError(getErrorMessage(error));
		});
	}, [sendClientMessage]);

	const activateSession = useCallback((sessionId: string | null, options: { load?: boolean } = {}) => {
		const { load = true } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			requestSessionSnapshot(sessionId);
		}
		focusPrompt();
	}, [focusPrompt, requestSessionSnapshot]);

	const upsertSessionSnapshot = useCallback((session: SessionSummary, transcript: TranscriptMessage[]) => {
		setSessionCache((previous) => {
			const next = new Map(previous);
			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
			});
			return next;
		});
		setSessions((previous) => upsertSessionInList(previous, session));
	}, []);

	const handleStartNewChat = useCallback(() => {
		activateSession(null, { load: false });
	}, [activateSession]);

	useEffect(() => {
		const eventSource = new EventSource(transportConfig.streamUrl);

		eventSource.onopen = () => {
			setConnected(true);
			setRelayError(null);
		};

		eventSource.onmessage = (event) => {
			const message = parseServerMessage(event.data);
			if (!message) {
				return;
			}

			switch (message.type) {
				case "connected": {
					setConnected(true);
					setRelayError(null);
					break;
				}
				case "sessions_updated": {
					setSessions(message.sessions);
					setSessionCache((previous) => {
						const next = new Map(previous);
						for (const session of message.sessions) {
							const cached = next.get(session.id);
							next.set(session.id, {
								session,
								transcript: cached?.transcript ?? [],
							});
						}
						return next;
					});

					const currentActiveSessionId = activeSessionIdRef.current;
					if (!currentActiveSessionId) {
						break;
					}

					const nextActiveSession = message.sessions.find((session) => session.id === currentActiveSessionId) ?? null;
					if (!nextActiveSession) {
						activateSession(null, { load: false });
						break;
					}

					const cached = sessionCacheRef.current.get(nextActiveSession.id);
					if (!cached || cached.session.updatedAt < nextActiveSession.updatedAt) {
						requestSessionSnapshot(nextActiveSession.id);
					}
					break;
				}
				case "session_created": {
					setRelayError(null);
					upsertSessionSnapshot(message.session, message.transcript);
					setPendingDraft(false);
					activateSession(message.session.id, { load: false });
					break;
				}
				case "session_snapshot": {
					setRelayError(null);
					upsertSessionSnapshot(message.session, message.transcript);
					break;
				}
				case "assistant_delta": {
					setSessionCache((previous) => {
						const cached = previous.get(message.sessionId);
						if (!cached) {
							return previous;
						}

						const messageIndex = cached.transcript.findIndex((entry) => entry.id === message.messageId);
						if (messageIndex === -1) {
							return previous;
						}

						const transcript = [...cached.transcript];
						const existingMessage = transcript[messageIndex];
						if (!existingMessage) {
							return previous;
						}

						transcript[messageIndex] = appendAssistantDeltaToMessage(
							existingMessage,
							message.delta,
							"body",
							message.contentIndex,
						);

						const next = new Map(previous);
						next.set(message.sessionId, {
							...cached,
							transcript,
						});
						return next;
					});
					break;
				}
				case "assistant_thinking_delta": {
					setSessionCache((previous) => {
						const cached = previous.get(message.sessionId);
						if (!cached) {
							return previous;
						}

						const messageIndex = cached.transcript.findIndex((entry) => entry.id === message.messageId);
						if (messageIndex === -1) {
							return previous;
						}

						const transcript = [...cached.transcript];
						const existingMessage = transcript[messageIndex];
						if (!existingMessage) {
							return previous;
						}

						transcript[messageIndex] = appendAssistantDeltaToMessage(
							existingMessage,
							message.delta,
							"thinking",
							message.contentIndex,
						);

						const next = new Map(previous);
						next.set(message.sessionId, {
							...cached,
							transcript,
						});
						return next;
					});
					break;
				}
				case "error": {
					setPendingDraft(false);
					setRelayError(message.message);
					break;
				}
				case "pong": {
					break;
				}
			}
		};

		eventSource.onerror = () => {
			setConnected(false);
			setRelayError((current) => current ?? STREAM_DISCONNECTED_MESSAGE);
		};

		return () => {
			eventSource.close();
			setConnected(false);
		};
	}, [activateSession, requestSessionSnapshot, upsertSessionSnapshot]);

	const submitPrompt = useCallback((trimmedPrompt: string) => {
		if (!trimmedPrompt || !connected || isBusy) {
			return false;
		}

		setRelayError(null);
		setPendingDraft(!activeSessionId);
		void sendClientMessage({
			type: "prompt",
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
		}).catch((error) => {
			setPendingDraft(false);
			setRelayError(getErrorMessage(error));
		});
		focusPrompt();
		return true;
	}, [activeSessionId, connected, focusPrompt, isBusy, sendClientMessage]);

	const handleAbort = useCallback(() => {
		if (!activeSession?.busy) {
			return;
		}

		void sendClientMessage({ type: "abort", sessionId: activeSession.id }).catch((error) => {
			setRelayError(getErrorMessage(error));
		});
	}, [activeSession, sendClientMessage]);

	const emptyState = !activeSession
		? {
			title: connected ? (pendingDraft ? "Creating session..." : "Ready when you are") : "Connecting...",
			body: connected
				? "Start with a coding task, file request, or bug report. The first prompt creates a reusable session that stays available in the left rail."
				: "Opening the server event stream.",
		}
		: activeTranscript.length === 0
			? {
				title: "Loading session...",
				body: `Fetching the latest transcript from the ${transportConfig.label}.`,
			}
			: null;
	const sessionState = formatSessionState(activeSession, pendingDraft);

	return (
		<main className="grid h-svh w-full overflow-hidden grid-cols-1 font-ui text-ink min-[721px]:grid-cols-[270px_minmax(0,1fr)] min-[1221px]:grid-cols-[320px_minmax(0,1fr)]">
			<Sidebar
				connected={connected}
				pendingDraft={pendingDraft}
				pairingState={pairingState}
				sessions={sessions}
				activeSessionId={activeSessionId}
				sessionState={sessionState}
				onStartNewChat={handleStartNewChat}
				onActivateSession={(sessionId) => activateSession(sessionId)}
			/>

			<section className="relative flex h-svh min-w-0 flex-col overflow-hidden">
				<TranscriptPanel
					transcriptRef={transcriptRef}
					activeSession={activeSession}
					activeTranscript={activeTranscript}
					emptyState={emptyState}
					relayError={relayError}
				/>
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 max-[860px]:px-3">
					<Composer
						connected={connected}
						connectionLabel={transportConfig.label}
						pairingState={pairingState}
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						promptInputRef={promptInputRef}
						onSend={submitPrompt}
						onAbort={handleAbort}
					/>
				</div>
			</section>
		</main>
	);
}
