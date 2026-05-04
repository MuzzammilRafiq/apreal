import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_CLIENT_ID_QUERY_PARAM, type LocalWebAdminStatus } from "@apreal/shared";
import { Composer } from "./components/Composer";
import { ScheduledJobsPage } from "./components/ScheduledJobsPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { ScheduledJobDetails, SessionCacheEntry, SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "./chatTypes";
import { formatSessionState } from "./chatView";
import {
	readCachedSessionSnapshot,
	readCachedSessionSummaries,
	writeSessionSnapshot,
	writeSessionSummaries,
	writeSessionSummary,
} from "./session-cache";
import {
	deleteScheduledJob as deleteScheduledJobRequest,
	readLocalAdminStatus,
	readScheduledJobRuns,
	readScheduledJobs,
	submitRelayReauthentication,
	updateScheduledJob as updateScheduledJobRequest,
} from "./server-admin";
import { getWebTransportConfig } from "./transport-config";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
const SESSION_PAGE_SIZE = 50;
const STREAM_DISCONNECTED_MESSAGE = "Disconnected from the server stream. Reconnecting...";
const STREAM_REQUIRED_MESSAGE = "Client event stream is not connected.";
const ADMIN_STATUS_REFRESH_INTERVAL_MS = 3_000;
const transportConfig = getWebTransportConfig();

type AppRoute = "chat" | "settings" | "jobs";

type ClientMessage =
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "load_sessions_page"; offset?: number; limit?: number }
	| { type: "ping" };

type ServerMessage =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| { type: "sessions_page"; sessions: SessionSummary[]; offset: number; limit: number; total: number }
	| { type: "session_summary_updated"; session: SessionSummary }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" };

type AssistantDeltaField = "body" | "thinking";

function readCurrentRoute(): AppRoute {
	if (window.location.pathname === "/settings") {
		return "settings";
	}

	if (window.location.pathname === "/jobs") {
		return "jobs";
	}

	return "chat";
}

function navigateToRoute(route: AppRoute) {
	const nextPathname = route === "settings" ? "/settings" : route === "jobs" ? "/jobs" : "/";
	if (window.location.pathname === nextPathname) {
		return;
	}

	window.history.pushState({}, "", nextPathname);
}

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

function isScheduledSessionSummary(session: SessionSummary | null | undefined): boolean {
	return Boolean(session?.title.startsWith("[Scheduled:"));
}

function createSummaryOnlyCacheEntry(session: SessionSummary): SessionCacheEntry {
	return {
		session,
		transcript: [],
		transcriptLoaded: false,
	};
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
	const [route, setRoute] = useState<AppRoute>(() => readCurrentRoute());
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [visibleSessionLimit, setVisibleSessionLimit] = useState(SESSION_PAGE_SIZE);
	const [serverLoadedSessionCount, setServerLoadedSessionCount] = useState(0);
	const [totalSessionCount, setTotalSessionCount] = useState<number | null>(null);
	const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
	const [scheduledJobs, setScheduledJobs] = useState<ScheduledJobDetails[]>([]);
	const [scheduledJobsError, setScheduledJobsError] = useState<string | null>(null);
	const [loadingScheduledJobs, setLoadingScheduledJobs] = useState(false);
	const [scheduledJobRuns, setScheduledJobRuns] = useState<SessionSummary[]>([]);
	const [scheduledJobRunsError, setScheduledJobRunsError] = useState<string | null>(null);
	const [loadingScheduledJobRuns, setLoadingScheduledJobRuns] = useState(false);
	const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const [submittingPairingCode, setSubmittingPairingCode] = useState(false);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [streamRequested, setStreamRequested] = useState(false);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const sessionsRef = useRef(sessions);
	const sessionCacheRef = useRef(sessionCache);
	const activeSessionIdRef = useRef(activeSessionId);
	const visibleSessionLimitRef = useRef(visibleSessionLimit);
	const pendingConnectionResolversRef = useRef(new Set<() => void>());
	const resolvePendingConnectionsRef = useRef<() => void>(() => {});
	const ensureSessionLoadedRef = useRef<(sessionId: string | null) => void>(() => {});
	const requestSessionPageRef = useRef<(offset?: number, limit?: number) => void>(() => {});
	const activateSessionRef = useRef<(sessionId: string | null, options?: { load?: boolean }) => void>(() => {});
	const upsertSessionSnapshotRef = useRef<(session: SessionSummary, transcript: TranscriptMessage[]) => void>(() => {});

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		sessionCacheRef.current = sessionCache;
	}, [sessionCache]);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	useEffect(() => {
		visibleSessionLimitRef.current = visibleSessionLimit;
	}, [visibleSessionLimit]);

	const visibleSessions = sessions.slice(0, visibleSessionLimit);
	const cachedActiveSession = activeSessionId ? sessionCache.get(activeSessionId)?.session ?? null : null;
	const activeSession =
		sessions.find((session) => session.id === activeSessionId) ??
		(cachedActiveSession && !isScheduledSessionSummary(cachedActiveSession) ? cachedActiveSession : null);
	const activeSessionCacheEntry = activeSessionId ? sessionCache.get(activeSessionId) ?? null : null;
	const activeTranscript = activeSessionCacheEntry?.transcriptLoaded ? activeSessionCacheEntry.transcript : [];
	const activeTranscriptLoaded = activeSessionCacheEntry?.transcriptLoaded ?? false;
	const serverReady = adminStatus !== null;
	const relayReady = Boolean(adminStatus?.relayReady);
	const relayTransportConnected = Boolean(adminStatus?.relayTransportConnected);
	const isBusy = pendingDraft || Boolean(activeSession?.busy);

	const focusPrompt = useCallback(() => {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}, []);

	const resolvePendingConnections = useCallback(() => {
		for (const resolve of pendingConnectionResolversRef.current) {
			resolve();
		}
		pendingConnectionResolversRef.current.clear();
	}, []);

	useEffect(() => {
		const handlePopState = () => {
			setRoute(readCurrentRoute());
		};

		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	useEffect(() => {
		resolvePendingConnectionsRef.current = resolvePendingConnections;
	}, [resolvePendingConnections]);

	const waitForConnectionAttempt = useCallback((timeoutMs = 1200) => {
		if (connected) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			let timeoutId = 0;
			const finish = () => {
				window.clearTimeout(timeoutId);
				pendingConnectionResolversRef.current.delete(finish);
				resolve();
			};

			timeoutId = window.setTimeout(finish, timeoutMs);
			pendingConnectionResolversRef.current.add(finish);
		});
	}, [connected]);

	const ensureClientTransport = useCallback(async () => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? "The local server is not ready yet.");
		}

		if (connected) {
			return;
		}

		setStreamRequested(true);
		await waitForConnectionAttempt();
	}, [adminStatusError, connected, serverReady, waitForConnectionAttempt]);

	const sendClientMessage = useCallback(async (message: ClientMessage) => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? "The local server is not ready yet.");
		}

		await ensureClientTransport();

		const performRequest = () => fetch(transportConfig.messageUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-pi-local-client-id": transportConfig.localClientId,
			},
			body: JSON.stringify(message),
		});

		let response = await performRequest();
		if (response.status === 409) {
			let payload: unknown = null;
			try {
				payload = await response.json();
			} catch {
				// Ignore malformed error bodies.
			}

			if (isObjectRecord(payload) && payload.message === STREAM_REQUIRED_MESSAGE) {
				await waitForConnectionAttempt();
				response = await performRequest();
			}
		}

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
	}, [adminStatusError, ensureClientTransport, serverReady, waitForConnectionAttempt]);

	const requestSessionPage = useCallback((offset = 0, limit = SESSION_PAGE_SIZE) => {
		void sendClientMessage({ type: "load_sessions_page", offset, limit }).catch((error) => {
			setLoadingMoreSessions(false);
			setConnectionError(getErrorMessage(error));
		});
	}, [sendClientMessage]);

	useEffect(() => {
		requestSessionPageRef.current = requestSessionPage;
	}, [requestSessionPage]);

	const ensureSessionLoaded = useCallback((sessionId: string | null) => {
		if (!sessionId) {
			return;
		}

		const summary =
			sessionsRef.current.find((session) => session.id === sessionId) ??
			sessionCacheRef.current.get(sessionId)?.session ??
			null;
		const inMemory = sessionCacheRef.current.get(sessionId);
		if (inMemory?.transcriptLoaded && (!summary || inMemory.session.revision >= summary.revision)) {
			return;
		}

		void (async () => {
			const cachedSnapshot = await readCachedSessionSnapshot(sessionId);
			if (cachedSnapshot) {
				upsertSessionSnapshotRef.current(cachedSnapshot.session, cachedSnapshot.transcript);
				if (!summary || cachedSnapshot.session.revision >= summary.revision) {
					return;
				}
			}

			try {
				await sendClientMessage({ type: "load_session", sessionId });
			} catch (error) {
				setConnectionError(getErrorMessage(error));
			}
		})();
	}, [sendClientMessage]);

	useEffect(() => {
		ensureSessionLoadedRef.current = ensureSessionLoaded;
	}, [ensureSessionLoaded]);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const cachedSessions = await readCachedSessionSummaries();
				if (cancelled) {
					return;
				}

				setSessions(cachedSessions.filter((session) => !isScheduledSessionSummary(session)));
				setTotalSessionCount((current) => current ?? cachedSessions.filter((session) => !isScheduledSessionSummary(session)).length);
				setSessionCache((previous) => {
					const next = new Map(previous);
					for (const session of cachedSessions) {
						const cached = next.get(session.id);
						next.set(session.id, cached
							? {
								...cached,
								session,
							}
							: createSummaryOnlyCacheEntry(session));
					}
					return next;
				});

				const currentActiveSessionId = activeSessionIdRef.current;
				if (!currentActiveSessionId) {
					return;
				}

				const cachedSnapshot = await readCachedSessionSnapshot(currentActiveSessionId);
				if (cancelled || !cachedSnapshot) {
					return;
				}

				upsertSessionSnapshotRef.current(cachedSnapshot.session, cachedSnapshot.transcript);
			} catch {
				// Ignore browser cache hydration failures.
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const activateSession = useCallback((sessionId: string | null, options: { load?: boolean } = {}) => {
		const { load = true } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			ensureSessionLoaded(sessionId);
		}
		focusPrompt();
	}, [ensureSessionLoaded, focusPrompt]);

	useEffect(() => {
		activateSessionRef.current = activateSession;
	}, [activateSession]);

	const upsertSessionSnapshot = useCallback((session: SessionSummary, transcript: TranscriptMessage[]) => {
		setSessionCache((previous) => {
			const next = new Map(previous);
			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
				transcriptLoaded: true,
			});
			return next;
		});
		if (!isScheduledSessionSummary(session)) {
			setSessions((previous) => upsertSessionInList(previous, session));
		}
		void writeSessionSnapshot(session, transcript);
	}, []);

	useEffect(() => {
		upsertSessionSnapshotRef.current = upsertSessionSnapshot;
	}, [upsertSessionSnapshot]);

	const handleStartNewChat = useCallback(() => {
		activateSession(null, { load: false });
	}, [activateSession]);

	useEffect(() => {
		const refreshAdminStatus = async () => {
			const nextStatus = await readLocalAdminStatus(transportConfig.statusUrl);
			setAdminStatus(nextStatus);
			setAdminStatusError(null);
			return nextStatus;
		};

		let cancelled = false;
		let refreshTimer: number | null = null;

		const pollAdminStatus = async () => {
			try {
				const nextStatus = await refreshAdminStatus();
				if (cancelled) {
					return;
				}

				setStreamRequested(true);
				if (!nextStatus.relayReady) {
					setSettingsMessage(null);
				}
			} catch (error) {
				if (cancelled) {
					return;
				}

				setAdminStatus(null);
				setAdminStatusError(getErrorMessage(error));
				setConnected(false);
			} finally {
				if (!cancelled) {
					refreshTimer = window.setTimeout(pollAdminStatus, ADMIN_STATUS_REFRESH_INTERVAL_MS);
				}
			}
		};

		void pollAdminStatus();

		return () => {
			cancelled = true;
			if (refreshTimer !== null) {
				window.clearTimeout(refreshTimer);
			}
		};
	}, []);

	useEffect(() => {
		if (serverReady) {
			setStreamRequested(true);
		}
	}, [serverReady]);

	useEffect(() => {
		if (!serverReady || !streamRequested) {
			setConnected(false);
			return;
		}

		const streamUrl = new URL(transportConfig.streamUrl);
		streamUrl.searchParams.set(LOCAL_CLIENT_ID_QUERY_PARAM, transportConfig.localClientId);
		const eventSource = new EventSource(streamUrl.toString());

		eventSource.onopen = () => {
			setConnected(true);
			setConnectionError(null);
			resolvePendingConnectionsRef.current();
		};

		eventSource.onmessage = (event) => {
			const message = parseServerMessage(event.data);
			if (!message) {
				return;
			}

			switch (message.type) {
				case "connected": {
					setConnected(true);
					setConnectionError(null);
					resolvePendingConnectionsRef.current();
					requestSessionPageRef.current(0, Math.max(visibleSessionLimitRef.current, SESSION_PAGE_SIZE));
					ensureSessionLoadedRef.current(activeSessionIdRef.current);
					break;
				}
				case "sessions_page": {
					setLoadingMoreSessions(false);
					setServerLoadedSessionCount((previous) => Math.max(previous, message.offset + message.sessions.length));
					setTotalSessionCount(message.total);
					setSessions((previous) => {
						let next = previous;
						for (const session of message.sessions) {
							if (!isScheduledSessionSummary(session)) {
								next = upsertSessionInList(next, session);
							}
						}
						return next;
					});
					setSessionCache((previous) => {
						const next = new Map(previous);
						for (const session of message.sessions) {
							const cached = next.get(session.id);
							next.set(session.id, cached
								? {
									...cached,
									session,
								}
								: createSummaryOnlyCacheEntry(session));
						}
						return next;
					});
					void writeSessionSummaries(message.sessions);

					const currentActiveSessionId = activeSessionIdRef.current;
					if (currentActiveSessionId) {
						ensureSessionLoadedRef.current(currentActiveSessionId);
					}
					break;
				}
				case "session_summary_updated": {
					if (!isScheduledSessionSummary(message.session)) {
						setSessions((previous) => upsertSessionInList(previous, message.session));
					}
					setSessionCache((previous) => {
						const next = new Map(previous);
						const cached = next.get(message.session.id);
						next.set(message.session.id, cached
							? {
								...cached,
								session: message.session,
							}
							: createSummaryOnlyCacheEntry(message.session));
						return next;
					});
					if (!isScheduledSessionSummary(message.session)) {
						setTotalSessionCount((previous) => {
							if (previous === null) {
								return Math.max(sessionsRef.current.length, 1);
							}
							const exists = sessionsRef.current.some((session) => session.id === message.session.id);
							return exists ? previous : previous + 1;
						});
					}
					void writeSessionSummary(message.session);

					if (activeSessionIdRef.current === message.session.id && !isScheduledSessionSummary(message.session)) {
						ensureSessionLoadedRef.current(message.session.id);
					}
					break;
				}
				case "session_created": {
					setConnectionError(null);
					upsertSessionSnapshotRef.current(message.session, message.transcript);
					if (!isScheduledSessionSummary(message.session)) {
						setTotalSessionCount((previous) => {
							if (previous === null) {
								return Math.max(sessionsRef.current.length, 1);
							}
							const exists = sessionsRef.current.some((session) => session.id === message.session.id);
							return exists ? previous : previous + 1;
						});
						setPendingDraft(false);
						activateSessionRef.current(message.session.id, { load: false });
					}
					break;
				}
				case "session_snapshot": {
					setConnectionError(null);
					upsertSessionSnapshotRef.current(message.session, message.transcript);
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
					setConnectionError(message.message);
					break;
				}
				case "pong": {
					break;
				}
			}
		};

		eventSource.onerror = () => {
			setConnected(false);
			setConnectionError((current) => current ?? STREAM_DISCONNECTED_MESSAGE);
		};

		return () => {
			eventSource.close();
			setConnected(false);
		};
	}, [serverReady, streamRequested]);

	const handleLoadMoreSessions = useCallback(() => {
		const nextVisibleLimit = visibleSessionLimitRef.current + SESSION_PAGE_SIZE;
		setVisibleSessionLimit(nextVisibleLimit);
		if (sessionsRef.current.length >= nextVisibleLimit) {
			return;
		}

		const knownTotal = totalSessionCount ?? sessionsRef.current.length;
		const needsServerPage =
			serverLoadedSessionCount < nextVisibleLimit &&
			serverLoadedSessionCount < knownTotal;
		if (!needsServerPage) {
			return;
		}

		setLoadingMoreSessions(true);
		requestSessionPage(serverLoadedSessionCount, SESSION_PAGE_SIZE);
	}, [requestSessionPage, serverLoadedSessionCount, totalSessionCount]);

	const submitPrompt = useCallback((trimmedPrompt: string) => {
		if (!trimmedPrompt || isBusy || !serverReady) {
			return false;
		}

		setConnectionError(null);
		setPendingDraft(!activeSessionId);
		void sendClientMessage({
			type: "prompt",
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
		}).catch((error) => {
			setPendingDraft(false);
			setConnectionError(getErrorMessage(error));
		});
		focusPrompt();
		return true;
	}, [activeSessionId, focusPrompt, isBusy, sendClientMessage, serverReady]);

	const handleAbort = useCallback(() => {
		if (!activeSession?.busy) {
			return;
		}

		void sendClientMessage({ type: "abort", sessionId: activeSession.id }).catch((error) => {
			setConnectionError(getErrorMessage(error));
		});
	}, [activeSession, sendClientMessage]);

	const emptyState = !activeSession
		? {
			title: !serverReady
				? "Waiting for local server"
				: connected
						? (pendingDraft ? "Creating session..." : "Ready when you are")
						: streamRequested ? "Connecting..." : "Ready when you are",
			body: !serverReady
				? (adminStatusError ?? "Start the local server to expose the browser UI and chat API.")
				: connected
				? "Start with a coding task, file request, or bug report. The first prompt creates a reusable session that stays available in the left rail."
				: !streamRequested
					? "Opening the local server event stream."
					: "Reconnecting to the local server event stream.",
		}
		: !activeTranscriptLoaded
			? {
				title: "Loading session...",
				body: `Fetching the latest transcript from the ${transportConfig.label}.`,
			}
			: null;
	const sessionState = formatSessionState(activeSession, pendingDraft);
	const canLoadMoreSessions = visibleSessionLimit < Math.max(totalSessionCount ?? 0, sessions.length);

	const refreshAdminStatus = useCallback(async () => {
		const nextStatus = await readLocalAdminStatus(transportConfig.statusUrl);
		setAdminStatus(nextStatus);
		setAdminStatusError(null);
		return nextStatus;
	}, []);

	const refreshScheduledJobs = useCallback(async () => {
		setLoadingScheduledJobs(true);
		try {
			const jobs = await readScheduledJobs();
			setScheduledJobs(jobs);
			setScheduledJobsError(null);
			if (jobs.length === 0) {
				setScheduledJobRuns([]);
				setScheduledJobRunsError(null);
			}
			return jobs;
		} catch (error) {
			setScheduledJobsError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingScheduledJobs(false);
		}
	}, []);

	const refreshScheduledJobRuns = useCallback(async (jobId: string) => {
		setLoadingScheduledJobRuns(true);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		try {
			const runs = await readScheduledJobRuns(jobId);
			setScheduledJobRuns(runs);
			setScheduledJobRunsError(null);
			return runs;
		} catch (error) {
			setScheduledJobRunsError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingScheduledJobRuns(false);
		}
	}, []);

	const updateScheduledJob = useCallback(async (jobId: string, intervalMinutes: number) => {
		await updateScheduledJobRequest(jobId, { intervalMinutes });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);

	const toggleScheduledJobEnabled = useCallback(async (jobId: string, enabled: boolean) => {
		await updateScheduledJobRequest(jobId, { enabled });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);

	const deleteScheduledJob = useCallback(async (jobId: string) => {
		await deleteScheduledJobRequest(jobId);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);

	const handleOpenJobs = useCallback(() => {
		navigateToRoute("jobs");
		setRoute("jobs");
	}, []);

	const handleRefreshJobs = useCallback(() => {
		void refreshScheduledJobs().catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobs]);

	const handleRefreshJobRuns = useCallback((jobId: string) => {
		void refreshScheduledJobRuns(jobId).catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobRuns]);

	const handleRouteChange = useCallback((nextRoute: AppRoute) => {
		navigateToRoute(nextRoute);
		setRoute(nextRoute);
	}, []);

	const handleSubmitPairingCode = useCallback((pairingCode: string) => {
		const trimmedPairingCode = pairingCode.trim();
		if (!trimmedPairingCode) {
			setSettingsError("A pairing code is required.");
			setSettingsMessage(null);
			return;
		}

		setSubmittingPairingCode(true);
		setSettingsError(null);
		setSettingsMessage(null);
		void submitRelayReauthentication(transportConfig.relayReauthenticateUrl, trimmedPairingCode)
			.then((response) => {
				setAdminStatus(response.status);
				setAdminStatusError(null);
				setSettingsMessage("Relay pairing updated. The server restarted its relay transport.");
			})
			.catch((error) => {
				setSettingsError(getErrorMessage(error));
			})
			.finally(() => {
				setSubmittingPairingCode(false);
			});
	}, []);

	useEffect(() => {
		if (route !== "jobs") {
			return;
		}

		void refreshScheduledJobs().catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobs, route]);

	if (route === "settings") {
		return (
			<SettingsPage
				adminStatus={adminStatus}
				statusError={adminStatusError}
				isSubmitting={submittingPairingCode}
				submissionMessage={settingsMessage}
				submissionError={settingsError}
				onBack={() => handleRouteChange("chat")}
				onRefresh={() => {
					void refreshAdminStatus().catch((error) => {
						setAdminStatus(null);
						setAdminStatusError(getErrorMessage(error));
					});
				}}
				onSubmitPairingCode={handleSubmitPairingCode}
			/>
		);
	}

	if (route === "jobs") {
		return (
			<ScheduledJobsPage
				adminStatus={adminStatus}
				jobs={scheduledJobs}
				jobRuns={scheduledJobRuns}
				sessionCache={sessionCache}
				jobsError={scheduledJobsError}
				jobRunsError={scheduledJobRunsError}
				isLoadingJobs={loadingScheduledJobs}
				isLoadingJobRuns={loadingScheduledJobRuns}
				connectionError={connectionError}
				onBack={() => handleRouteChange("chat")}
				onRefreshJobs={handleRefreshJobs}
				onRefreshJobRuns={handleRefreshJobRuns}
				onUpdateJobInterval={updateScheduledJob}
				onToggleJobEnabled={toggleScheduledJobEnabled}
				onDeleteJob={deleteScheduledJob}
				onEnsureRunLoaded={ensureSessionLoaded}
			/>
		);
	}

	return (
		<main className="grid h-svh w-full overflow-hidden grid-cols-1 font-ui text-ink min-[721px]:grid-cols-[270px_minmax(0,1fr)] min-[1221px]:grid-cols-[320px_minmax(0,1fr)]">
			<Sidebar
				connected={connected}
				serverReady={serverReady}
				relayReady={relayReady}
				relayTransportConnected={relayTransportConnected}
				streamRequested={streamRequested}
				pendingDraft={pendingDraft}
				sessions={visibleSessions}
				totalSessions={totalSessionCount ?? sessions.length}
				loadingMoreSessions={loadingMoreSessions}
				canLoadMoreSessions={canLoadMoreSessions}
				activeSessionId={activeSessionId}
				sessionState={sessionState}
				onStartNewChat={handleStartNewChat}
				onOpenJobs={handleOpenJobs}
				onOpenSettings={() => handleRouteChange("settings")}
				onActivateSession={(sessionId) => activateSession(sessionId)}
				onLoadMoreSessions={handleLoadMoreSessions}
			/>

			<section className="relative flex h-svh min-w-0 flex-col overflow-hidden">
				<TranscriptPanel
					transcriptRef={transcriptRef}
					activeSession={activeSession}
					activeTranscript={activeTranscript}
					emptyState={emptyState}
					connectionError={connectionError}
				/>
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 max-[860px]:px-3">
					<Composer
						connected={connected}
						serverReady={serverReady}
						streamRequested={streamRequested}
						connectionLabel={transportConfig.label}
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
