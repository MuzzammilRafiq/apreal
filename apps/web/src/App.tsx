import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import { formatSessionState } from "./chatView";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";

type ServerMessage =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "sessions_updated"; sessions: SessionSummary[] }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" };

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

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: (entry.toolCalls ?? []).map((toolCall) => ({ ...toolCall })),
	}));
}

function upsertSessionInList(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
	const next = sessions.filter((entry) => entry.id !== session.id);
	next.push(session);
	next.sort((left, right) => right.updatedAt - left.updatedAt);
	return next;
}

function resolveWebSocketUrl(): string {
	const configuredUrl = import.meta.env.VITE_PI_SERVER_URL?.trim();
	if (!configuredUrl) {
		if (import.meta.env.DEV) {
			return "ws://localhost:3000/ws";
		}

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		return `${protocol}//${window.location.host}/ws`;
	}

	const url = new URL(configuredUrl, window.location.href);
	if (url.protocol === "http:") {
		url.protocol = "ws:";
	}
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	}
	if (!url.pathname || url.pathname === "/") {
		url.pathname = "/ws";
	}

	return url.toString();
}

export function App() {
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [tools, setTools] = useState("read, bash, edit, write");
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [prompt, setPrompt] = useState("");

	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const sessionCacheRef = useRef(sessionCache);
	const activeSessionIdRef = useRef(activeSessionId);

	useEffect(() => {
		sessionCacheRef.current = sessionCache;
	}, [sessionCache]);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
	const activeTranscript = activeSessionId ? sessionCache.get(activeSessionId)?.transcript ?? [] : [];
	const isBusy = pendingDraft || Boolean(activeSession?.busy);
	const canSend = connected && !isBusy && prompt.trim().length > 0;

	useEffect(() => {
		const node = transcriptRef.current;
		if (!node) {
			return;
		}

		node.scrollTop = node.scrollHeight;
	}, [activeTranscript, activeSessionId]);

	function focusPrompt() {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}

	function submitPrompt(trimmedPrompt: string) {
		const socket = socketRef.current;
		if (!trimmedPrompt || !socket || socket.readyState !== WebSocket.OPEN || isBusy) {
			return;
		}

		setPendingDraft(!activeSessionId);
		socket.send(
			JSON.stringify({
				type: "prompt",
				prompt: trimmedPrompt,
				sessionId: activeSessionId,
			}),
		);
		setPrompt("");
		focusPrompt();
	}

	function requestSessionSnapshot(sessionId: string | null) {
		const socket = socketRef.current;
		if (!sessionId || !socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		socket.send(JSON.stringify({ type: "load_session", sessionId }));
	}

	function activateSession(sessionId: string | null, options: { load?: boolean } = {}) {
		const { load = true } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			requestSessionSnapshot(sessionId);
		}
		focusPrompt();
	}

	function upsertSessionSnapshot(session: SessionSummary, transcript: TranscriptMessage[]) {
		setSessionCache((previous) => {
			const next = new Map(previous);
			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
			});
			return next;
		});
		setSessions((previous) => upsertSessionInList(previous, session));
	}

	function applyAssistantDelta(sessionId: string, messageId: string, delta: string, field: "body" | "thinking") {
		setSessionCache((previous) => {
			const cached = previous.get(sessionId);
			if (!cached) {
				return previous;
			}

			const transcript = cached.transcript.map((entry) => {
				if (entry.id !== messageId) {
					return entry;
				}

				return {
					...entry,
					pending: true,
					[field]: `${entry[field] ?? ""}${delta}`,
				};
			});

			const next = new Map(previous);
			next.set(sessionId, {
				...cached,
				transcript,
			});
			return next;
		});
	}

	useEffect(() => {
		let disposed = false;

		const connect = () => {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}

			const socket = new WebSocket(resolveWebSocketUrl());
			socketRef.current = socket;

			socket.addEventListener("open", () => {
				if (disposed) {
					socket.close();
					return;
				}

				setConnected(true);
			});

			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data) as ServerMessage;

				switch (message.type) {
					case "connected": {
						setTools(message.tools || "read, bash, edit, write");
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
						upsertSessionSnapshot(message.session, message.transcript);
						setPendingDraft(false);
						activateSession(message.session.id, { load: false });
						break;
					}
					case "session_snapshot": {
						upsertSessionSnapshot(message.session, message.transcript);
						break;
					}
					case "assistant_delta": {
						applyAssistantDelta(message.sessionId, message.messageId, message.delta, "body");
						break;
					}
					case "assistant_thinking_delta": {
						applyAssistantDelta(message.sessionId, message.messageId, message.delta, "thinking");
						break;
					}
					case "error": {
						console.error(message.message);
						break;
					}
					case "pong": {
						break;
					}
				}
			});

			socket.addEventListener("close", () => {
				if (socketRef.current === socket) {
					socketRef.current = null;
				}
				setConnected(false);
				setPendingDraft(false);

				if (!disposed) {
					reconnectTimerRef.current = window.setTimeout(connect, 1500);
				}
			});

			socket.addEventListener("error", () => {
				setConnected(false);
			});
		};

		connect();

		return () => {
			disposed = true;
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
			}
			socketRef.current?.close();
			socketRef.current = null;
		};
	}, []);

	function handleSend() {
		submitPrompt(prompt.trim());
	}

	function handleAbort() {
		const socket = socketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN || !activeSession || !activeSession.busy) {
			return;
		}

		socket.send(JSON.stringify({ type: "abort", sessionId: activeSession.id }));
	}

	const emptyState = !activeSession
		? {
			title: pendingDraft ? "Creating session..." : "Ready when you are",
			body: pendingDraft
				? "The server is opening a shared session from your first prompt."
				: "Start with a coding task, file request, or bug report. The first prompt creates a reusable session that stays available in the left rail.",
		}
		: activeTranscript.length === 0
			? {
				title: "Loading session...",
				body: "Fetching the latest transcript from the local server.",
			}
			: null;
	const sessionState = formatSessionState(activeSession, pendingDraft);

	return (
		<main className="grid h-svh w-full overflow-hidden grid-cols-1 font-ui text-ink min-[721px]:grid-cols-[270px_minmax(0,1fr)] min-[1221px]:grid-cols-[320px_minmax(0,1fr)]">
			<Sidebar
				connected={connected}
				pendingDraft={pendingDraft}
				sessions={sessions}
				activeSessionId={activeSessionId}
				sessionState={sessionState}
				onStartNewChat={() => activateSession(null, { load: false })}
				onActivateSession={activateSession}
			/>

			<section className="relative flex h-svh min-w-0 flex-col overflow-hidden">
				<TranscriptPanel transcriptRef={transcriptRef} activeSession={activeSession} activeTranscript={activeTranscript} emptyState={emptyState} />
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 max-[860px]:px-3">
					<Composer
						connected={connected}
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						canSend={canSend}
						prompt={prompt}
						promptInputRef={promptInputRef}
						onPromptChange={setPrompt}
						onSend={handleSend}
						onAbort={handleAbort}
					/>
				</div>
			</section>
		</main>
	);
}