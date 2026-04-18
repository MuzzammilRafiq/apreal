import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";

type TranscriptToolCall = {
	id: string;
	name: string;
	summary: string;
	status: "running" | "completed" | "failed";
	createdAt: number;
	updatedAt: number;
};

type TranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "error";
	body: string;
	thinking: string;
	toolCalls: TranscriptToolCall[];
	pending: boolean;
	createdAt: number;
};

type SessionSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
};

type SessionCacheEntry = {
	session: SessionSummary;
	transcript: TranscriptMessage[];
};

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

function formatRole(role: TranscriptMessage["role"]): string {
	switch (role) {
		case "user":
			return "You";
		case "assistant":
			return "Assistant";
		case "error":
			return "Error";
		default:
			return "System";
	}
}

function formatRelativeTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();
	return sameDay
		? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		: date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatToolStatus(status: TranscriptToolCall["status"]): string {
	switch (status) {
		case "running":
			return "Running";
		case "failed":
			return "Failed";
		default:
			return "Completed";
	}
}

function formatSessionState(session: SessionSummary | null, pendingDraft: boolean): string {
	if (!session) {
		return pendingDraft ? "Starting" : "Draft";
	}

	return session.busy ? "Running" : "Saved";
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

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmedPrompt = prompt.trim();
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

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
		}
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

	return (
		<main className="shell">
			<aside className="sidebar">
				<div className="sidebar-header">
					<button
						type="button"
						id="new-chat-button"
						className={!activeSessionId && !pendingDraft ? "button-selected" : undefined}
						onClick={() => activateSession(null, { load: false })}
					>
						Start new chat
					</button>
				</div>
				<div className="sidebar-sessions">
					<div className="sidebar-section-header">
						<p className="sidebar-section-label">Sessions</p>
						<p id="session-count" className="sidebar-section-count">
							{sessions.length}
						</p>
					</div>
					<div id="session-list" className="session-list" aria-label="Chat sessions">
						{sessions.length === 0 ? (
							<p className="session-empty">
								No saved sessions yet. Start a new chat and your first prompt will turn into a reusable thread here.
							</p>
						) : (
							sessions.map((session) => (
								<button
									key={session.id}
									type="button"
									className={`session-card ${session.id === activeSessionId ? "session-card-active" : ""}`.trim()}
									aria-pressed={session.id === activeSessionId}
									onClick={() => activateSession(session.id)}
								>
									<div className="session-card-top">
										<p className="session-card-title">{session.title}</p>
										<span className="session-card-time">
											{session.busy ? "Running" : formatRelativeTime(session.updatedAt)}
										</span>
									</div>
									<p className="session-card-preview">{session.preview}</p>
									<p className="session-card-meta">{session.model || "Model starts on first response"}</p>
								</button>
							))
						)}
					</div>
				</div>
				<div className="sidebar-footer">
					<p className="sidebar-footer-label">Status</p>
					<p id="sidebar-status" className="sidebar-footer-value">
						{connected ? "Connected" : "Disconnected - reconnecting..."}
					</p>
				</div>
			</aside>

			<section className="panel-chat">
				<div className="workspace">
					<div className="conversation-stage">
						<div ref={transcriptRef} id="transcript" className="transcript" aria-live="polite">
							{emptyState ? (
								<div className="empty-transcript">
									<p className="empty-transcript-title">{emptyState.title}</p>
									<p className="empty-transcript-body">{emptyState.body}</p>
								</div>
							) : (
								activeTranscript.map((item) => {
									const shouldShowPlaceholder =
										item.pending && !item.body && !item.thinking.trim() && item.toolCalls.length === 0;

									return (
										<article
											key={item.id}
											className={`message message-${item.role} ${item.pending ? "message-pending" : ""}`.trim()}
										>
											<p className="message-role">{formatRole(item.role)}</p>
											{(item.body || shouldShowPlaceholder) && (
												<p className="message-body">{item.body || "Thinking..."}</p>
											)}

											{item.role === "assistant" && item.toolCalls.length > 0 && (
												<section className="message-toolbox">
													<p className="message-supplement-label">Tool calls</p>
													<div className="message-tool-list">
														{item.toolCalls.map((toolCall) => (
															<div key={toolCall.id} className="message-tool-item">
																<div className="message-tool-top">
																	<p className="message-tool-name">{toolCall.name}</p>
																	<span className={`message-tool-status message-tool-status-${toolCall.status}`}>
																		{formatToolStatus(toolCall.status)}
																	</span>
																</div>
																<p className="message-tool-summary">{toolCall.summary}</p>
															</div>
														))}
													</div>
												</section>
											)}

											{item.role === "assistant" && item.thinking.trim() && (
												<details className="message-thinking" open={item.pending}>
													<summary className="message-thinking-summary">
														{item.pending ? "Thinking trace (live)" : "Thinking trace"}
													</summary>
													<pre className="message-thinking-body">{item.thinking}</pre>
												</details>
											)}
										</article>
									);
								})
							)}
						</div>
					</div>
				</div>

				<form id="composer" className="composer" onSubmit={handleSubmit}>
					<div className="composer-box">
						<label className="sr-only" htmlFor="prompt-input">
							Message Pi
						</label>
						<textarea
							ref={promptInputRef}
							id="prompt-input"
							name="prompt"
							rows={3}
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							onKeyDown={handleKeyDown}
							disabled={!connected}
							placeholder={
								!connected
									? "Reconnecting to the local Pi server..."
									: activeSessionId
										? "Continue this session with the next task, follow-up, or code request"
										: "Describe what you want Pi to inspect, fix, or build"
							}
						/>
						<div className="composer-actions">
							<p className="composer-hint">Enter to send. Shift + Enter for a new line.</p>
							<div className="composer-buttons">
								<button
									type="button"
									id="abort-button"
									className="btn-abort"
									disabled={!connected || !activeSession || !activeSession.busy}
									onClick={handleAbort}
								>
									Stop run
								</button>
								<button
									type="submit"
									id="send-button"
									className="btn-send"
									disabled={!canSend}
								>
									Send prompt
								</button>
							</div>
						</div>
					</div>
				</form>
			</section>
		</main>
	);
}