import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRouteView } from "./AppRouteView";
import { authClient } from "./auth/auth-client";
import { AuthGate } from "./components/AuthGate";
import type { ScheduledJobDetails, SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import { createBrowserUuid } from "./local-client";
import {
	clearCachedSessions,
	deleteCachedSession,
	readCachedSessionSnapshot,
	readCachedSessionSummaries,
	readCachedTranscriptRevisions,
	replaceSessionSummaries,
	writeSessionSnapshot,
	writeSessionSummaries,
	writeSessionSummary,
} from "./session-cache";
import {
	SESSION_PAGE_SIZE,
	STREAM_DISCONNECTED_MESSAGE,
	STREAM_REQUIRED_MESSAGE,
	appendAssistantDeltaToMessage,
	cloneTranscript,
	createSummaryOnlyCacheEntry,
	getErrorMessage,
	isClientStreamRequiredError,
	isScheduledSessionSummary,
	navigateToRoute,
	parseServerMessage,
	readCurrentRoute,
	readSelectedJobIdFromRoute,
	readStoredSessionId,
	storeActiveSessionId,
	upsertSessionInList,
	type AppRoute,
	type ClientMessage,
} from "./app-state";

type PendingConnectionWaiter = {
	resolve(): void;
	reject(error: Error): void;
	timer: number;
};
import { coerceRouteForCapabilities, type WebEventStream, type WebRuntime } from "./runtime";
import { useAppAdmin } from "./useAppAdmin";

type AppProps = {
	runtime: WebRuntime;
};

type PendingPrompt = {
	id: string;
	prompt: string;
	sessionId: string | null;
};

type BufferedAssistantDelta = {
	messageId: string;
	delta: string;
	field: "body" | "thinking";
	contentIndex: number;
};

const STREAM_RENDER_INTERVAL_MS = 50;


function createOptimisticTranscript(transcript: TranscriptMessage[], pendingPrompt: PendingPrompt | null): TranscriptMessage[] {
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

function transcriptContainsPrompt(transcript: TranscriptMessage[], prompt: string): boolean {
	return transcript.some((message) => message.role === "user" && message.body.trim() === prompt);
}

function applyBufferedAssistantDelta(
	transcript: TranscriptMessage[],
	bufferedDelta: BufferedAssistantDelta,
): TranscriptMessage[] {
	const messageIndex = transcript.findIndex((entry) => entry.id === bufferedDelta.messageId);
	if (messageIndex === -1) {
		return transcript;
	}

	const existingMessage = transcript[messageIndex];
	if (!existingMessage) {
		return transcript;
	}

	const nextTranscript = [...transcript];
	nextTranscript[messageIndex] = appendAssistantDeltaToMessage(
		existingMessage,
		bufferedDelta.delta,
		bufferedDelta.field,
		bufferedDelta.contentIndex,
	);
	return nextTranscript;
}

export function App({ runtime }: AppProps) {
	const { data: authSession, isPending: authSessionPending } = authClient.useSession();
	const [route, setRoute] = useState<AppRoute>(() => coerceRouteForCapabilities(readCurrentRoute(), runtime.capabilities));
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [liveTranscriptOverrides, setLiveTranscriptOverrides] = useState<Map<string, TranscriptMessage[]>>(() => new Map());
	const [cachedTranscriptRevisions, setCachedTranscriptRevisions] = useState<Map<string, number>>(() => new Map());
	const [sessionIdsWithInactiveUpdates, setSessionIdsWithInactiveUpdates] = useState<Set<string>>(() => new Set());
	const [visibleSessionLimit, setVisibleSessionLimit] = useState(SESSION_PAGE_SIZE);
	const [totalSessionCount, setTotalSessionCount] = useState<number | null>(null);
	const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [streamRequested, setStreamRequested] = useState(false);
	const [streamGeneration, setStreamGeneration] = useState(0);
	const [abortingSessionId, setAbortingSessionId] = useState<string | null>(null);
	const signedIn = Boolean(authSession?.user);
	const signInRequired = !authSessionPending && !signedIn;
	const connectedRef = useRef(connected);
	const restartEventStream = useCallback(() => {
		connectedRef.current = false;
		setConnected(false);
		setStreamRequested(true);
		setStreamGeneration((current) => current + 1);
	}, []);
	const {
		adminStatus, adminStatusError, transportStatusMessage, serverReady: relayReady, transportReady, providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		authorizedSettingsSections,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
		handleServerMessage,
	} = useAppAdmin({ route, runtime, enabled: signedIn, connected, restartEventStream, setConnected, setStreamRequested });
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const serverLoadedSessionCountRef = useRef(0);
	const sessionsRef = useRef(sessions);
	const sessionCacheRef = useRef(sessionCache);
	const activeSessionIdRef = useRef(activeSessionId);
	const visibleSessionLimitRef = useRef(visibleSessionLimit);
	const bufferedAssistantDeltasRef = useRef<Map<string, BufferedAssistantDelta[]>>(new Map());
	const lastSeenSyncSeqRef = useRef(0);
	const streamFlushTimerRef = useRef<number | null>(null);
	const pendingConnectionResolversRef = useRef(new Set<PendingConnectionWaiter>());
	const resolvePendingConnectionsRef = useRef<() => void>(() => {});
	const ensureSessionLoadedRef = useRef<(sessionId: string | null) => void>(() => {});
	const requestSessionPageRef = useRef<(offset?: number, limit?: number) => void>(() => {});
	const activateSessionRef = useRef<(sessionId: string | null, options?: { load?: boolean; focus?: boolean }) => void>(() => {});
	const upsertSessionSnapshotRef = useRef<(
		session: SessionSummary,
		transcript: TranscriptMessage[],
		options?: { persist?: boolean },
	) => void>(() => {});

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

	useEffect(() => {
		connectedRef.current = connected;
	}, [connected]);

	const visibleSessions = sessions.slice(0, visibleSessionLimit);
	const cachedActiveSession = activeSessionId ? sessionCache.get(activeSessionId)?.session ?? null : null;
	const activeSession =
		sessions.find((session) => session.id === activeSessionId) ??
		(cachedActiveSession && !isScheduledSessionSummary(cachedActiveSession) ? cachedActiveSession : null);
	const activeSessionCacheEntry = activeSessionId ? sessionCache.get(activeSessionId) ?? null : null;
	const activeLiveTranscript = activeSessionId ? liveTranscriptOverrides.get(activeSessionId) ?? null : null;
	const activeTranscriptAvailable = Boolean(activeLiveTranscript || activeSessionCacheEntry?.transcriptLoaded);
	const activeTranscript = activeLiveTranscript ?? (activeSessionCacheEntry?.transcript ?? []);
	const activePendingPrompt =
		pendingPrompt && pendingPrompt.sessionId === activeSessionId && (activeTranscriptAvailable || !activeSessionId)
			? pendingPrompt
			: null;
	const displayedActiveTranscript = createOptimisticTranscript(activeTranscript, activePendingPrompt);
	const sessionIdsNeedingSync = useMemo(() => {
		const ids = new Set(sessionIdsWithInactiveUpdates);
		for (const session of sessions) {
			const cached = sessionCache.get(session.id);
			const cachedRevision = Math.max(
				cached?.transcriptRevision ?? -1,
				cachedTranscriptRevisions.get(session.id) ?? -1,
			);
			if (cachedRevision < session.revision) {
				ids.add(session.id);
			}
		}
		return ids;
	}, [cachedTranscriptRevisions, sessionCache, sessionIdsWithInactiveUpdates, sessions]);
	const serverReady = transportReady;
	const effectiveCapabilities = useMemo(() => ({
		...runtime.capabilities,
		settings: authorizedSettingsSections.length > 0,
		settingsSections: authorizedSettingsSections,
	}), [authorizedSettingsSections, runtime.capabilities]);
	const composerBlockedReason = authSessionPending ? "Checking your sign-in status..." : null;
	const chatTransportReady = relayReady && !composerBlockedReason;
	const previousChatTransportReadyRef = useRef(chatTransportReady);
	const isBusy = pendingDraft || Boolean(activeSession?.busy);
	const aborting = Boolean(activeSessionId && activeSessionId === abortingSessionId);

	useEffect(() => {
		if (chatTransportReady === previousChatTransportReadyRef.current) {
			return;
		}

		previousChatTransportReadyRef.current = chatTransportReady;
		if (chatTransportReady) {
			setStreamRequested(true);
		} else {
			setStreamRequested(false);
			setConnected(false);
		}
	}, [chatTransportReady, setConnected, setStreamRequested]);

	const focusPrompt = useCallback(() => {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}, []);

	const clearBufferedAssistantDeltas = useCallback((sessionId?: string) => {
		if (sessionId) {
			bufferedAssistantDeltasRef.current.delete(sessionId);
			setLiveTranscriptOverrides((previous) => {
				if (!previous.has(sessionId)) {
					return previous;
				}

				const next = new Map(previous);
				next.delete(sessionId);
				return next;
			});
			return;
		}

		bufferedAssistantDeltasRef.current.clear();
		setLiveTranscriptOverrides((previous) => (previous.size === 0 ? previous : new Map()));
	}, []);

	const flushBufferedAssistantDeltas = useCallback((sessionId?: string) => {
		const drained = new Map<string, BufferedAssistantDelta[]>();
		if (sessionId) {
			const pending = bufferedAssistantDeltasRef.current.get(sessionId);
			if (pending && pending.length > 0) {
				drained.set(sessionId, pending);
				bufferedAssistantDeltasRef.current.delete(sessionId);
			}
		} else {
			for (const [bufferedSessionId, pending] of bufferedAssistantDeltasRef.current.entries()) {
				if (pending.length > 0) {
					drained.set(bufferedSessionId, pending);
				}
			}
			bufferedAssistantDeltasRef.current.clear();
		}

		if (drained.size === 0) {
			return;
		}


		setLiveTranscriptOverrides((previous) => {
			let next = previous;

			for (const [bufferedSessionId, pending] of drained.entries()) {
				const sourceTranscript =
					next.get(bufferedSessionId) ??
					sessionCacheRef.current.get(bufferedSessionId)?.transcript;
				if (!sourceTranscript) {
					const existingPending = bufferedAssistantDeltasRef.current.get(bufferedSessionId) ?? [];
					bufferedAssistantDeltasRef.current.set(bufferedSessionId, [...pending, ...existingPending]);
					continue;
				}

				let transcript = cloneTranscript(sourceTranscript);
				for (const bufferedDelta of pending) {
					transcript = applyBufferedAssistantDelta(transcript, bufferedDelta);
				}

				if (next === previous) {
					next = new Map(previous);
				}
				next.set(bufferedSessionId, transcript);
			}

			return next;
		});
	}, []);

	const scheduleBufferedAssistantDeltaFlush = useCallback(() => {
		if (streamFlushTimerRef.current !== null) {
			return;
		}

		streamFlushTimerRef.current = window.setTimeout(() => {
			streamFlushTimerRef.current = null;
			flushBufferedAssistantDeltas();
		}, STREAM_RENDER_INTERVAL_MS);
	}, [flushBufferedAssistantDeltas]);

	const bufferAssistantDelta = useCallback((
		sessionId: string,
		bufferedDelta: BufferedAssistantDelta,
	) => {
		const nextPending = bufferedAssistantDeltasRef.current.get(sessionId) ?? [];
		nextPending.push(bufferedDelta);
		bufferedAssistantDeltasRef.current.set(sessionId, nextPending);
		scheduleBufferedAssistantDeltaFlush();
	}, [scheduleBufferedAssistantDeltaFlush]);

	const resolvePendingConnections = useCallback(() => {
		for (const waiter of pendingConnectionResolversRef.current) {
			window.clearTimeout(waiter.timer);
			waiter.resolve();
		}
		pendingConnectionResolversRef.current.clear();
	}, []);

	useEffect(() => {
		const handlePopState = () => {
			setRoute(coerceRouteForCapabilities(readCurrentRoute(), effectiveCapabilities));
		};

		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, [effectiveCapabilities]);

	useEffect(() => {
		const supportedRoute = coerceRouteForCapabilities(readCurrentRoute(), effectiveCapabilities);
		if (supportedRoute !== readCurrentRoute()) {
			navigateToRoute(supportedRoute);
		}
		setRoute(supportedRoute);
	}, [effectiveCapabilities]);

	useEffect(() => {
		resolvePendingConnectionsRef.current = resolvePendingConnections;
	}, [resolvePendingConnections]);

	useEffect(() => () => {
		if (streamFlushTimerRef.current !== null) {
			window.clearTimeout(streamFlushTimerRef.current);
			streamFlushTimerRef.current = null;
		}
	}, []);

	const waitForConnectionAttempt = useCallback((timeoutMs = 8_000) => {
		if (connectedRef.current) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			let waiter: PendingConnectionWaiter;
			const timer = window.setTimeout(() => {
				pendingConnectionResolversRef.current.delete(waiter);
				resolve();
			}, timeoutMs);
			waiter = {
				timer,
				resolve,
				reject: () => {
					pendingConnectionResolversRef.current.delete(waiter);
					resolve();
				},
			};
			pendingConnectionResolversRef.current.add(waiter);
		});
	}, []);

	const waitForFreshConnection = useCallback((timeoutMs = 8_000) => new Promise<void>((resolve, reject) => {
		let waiter: PendingConnectionWaiter;
		const timer = window.setTimeout(() => {
			pendingConnectionResolversRef.current.delete(waiter);
			reject(new Error(STREAM_REQUIRED_MESSAGE));
		}, timeoutMs);
		waiter = {
			timer,
			resolve,
			reject,
		};
		pendingConnectionResolversRef.current.add(waiter);
	}), []);

	const ensureClientTransport = useCallback(async () => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody);
		}

		if (connectedRef.current) {
			return;
		}

		setStreamRequested(true);
		await waitForConnectionAttempt();
		if (!connectedRef.current) {
			throw new Error(STREAM_REQUIRED_MESSAGE);
		}
	}, [adminStatusError, runtime, serverReady, transportStatusMessage, waitForConnectionAttempt]);

	const sendClientMessage = useCallback(async (message: ClientMessage) => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody);
		}

		await ensureClientTransport();

		try {
			await runtime.transport.sendMessage(message);
		} catch (error) {
			if (isClientStreamRequiredError(error)) {
				restartEventStream();
				await waitForFreshConnection();
				await runtime.transport.sendMessage(message);
				return;
			}
			throw error;
		}
	}, [adminStatusError, ensureClientTransport, restartEventStream, runtime, serverReady, streamRequested, transportStatusMessage, waitForFreshConnection]);

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
		if (inMemory?.transcriptLoaded && (!summary || (inMemory.transcriptRevision ?? -1) >= summary.revision)) {
			void sendClientMessage({
				type: "load_session",
				sessionId,
				knownRevision: inMemory.transcriptRevision ?? undefined,
			}).catch((error) => {
				setConnectionError(getErrorMessage(error));
			});
			return;
		}

		void (async () => {
			try {
				const cachedSnapshot = await readCachedSessionSnapshot(sessionId);
				if (cachedSnapshot) {
					upsertSessionSnapshotRef.current(cachedSnapshot.session, cachedSnapshot.transcript, { persist: false });
					if (!summary || cachedSnapshot.session.revision >= summary.revision) {
						await sendClientMessage({
							type: "load_session",
							sessionId,
							knownRevision: cachedSnapshot.session.revision,
						});
						return;
					}
				}

				await sendClientMessage({ type: "load_session", sessionId });
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					return;
				}
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
				const cachedTranscriptRevisions = await readCachedTranscriptRevisions();
				if (cancelled) {
					return;
				}

				setCachedTranscriptRevisions(cachedTranscriptRevisions);
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

				upsertSessionSnapshotRef.current(cachedSnapshot.session, cachedSnapshot.transcript, { persist: false });
			} catch {
				// Ignore browser cache hydration failures.
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const activateSession = useCallback((sessionId: string | null, options: { load?: boolean; focus?: boolean } = {}) => {
		const { load = true, focus = false } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		if (sessionId) {
			setSessionIdsWithInactiveUpdates((previous) => {
				if (!previous.has(sessionId)) {
					return previous;
				}
				const next = new Set(previous);
				next.delete(sessionId);
				return next;
			});
		}
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			ensureSessionLoaded(sessionId);
		}
		if (focus) {
			focusPrompt();
		}
	}, [ensureSessionLoaded, focusPrompt]);

	useEffect(() => {
		activateSessionRef.current = activateSession;
	}, [activateSession]);

	const upsertSessionSnapshot = useCallback((
		session: SessionSummary,
		transcript: TranscriptMessage[],
		options: { persist?: boolean } = {},
	) => {
		setSessionCache((previous) => {
			const next = new Map(previous);
			const cached = next.get(session.id);
			if (cached?.transcriptLoaded && cached.session.revision > session.revision) {
				return previous;
			}

			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
				transcriptLoaded: true,
				transcriptRevision: session.revision,
			});
			return next;
		});
		if (!isScheduledSessionSummary(session)) {
			setSessions((previous) => {
				const existing = previous.find((entry) => entry.id === session.id);
				const latestSession = existing && existing.revision > session.revision ? existing : session;
				return upsertSessionInList(previous, latestSession);
			});
		}
		if (options.persist ?? true) {
			setCachedTranscriptRevisions((previous) => {
				const next = new Map(previous);
				next.set(session.id, session.revision);
				return next;
			});
			void writeSessionSnapshot(session, transcript);
		}
	}, []);

	useEffect(() => {
		upsertSessionSnapshotRef.current = upsertSessionSnapshot;
	}, [upsertSessionSnapshot]);

	const handleStartNewChat = useCallback(() => {
		activateSession(null, { load: false, focus: true });
	}, [activateSession]);

	useEffect(() => {
		if (!chatTransportReady || !streamRequested) {
			return;
		}

		let eventSource: WebEventStream | null = null;
		let cancelled = false;

		const connect = async () => {
			try {
				eventSource = await runtime.transport.openEventStream({ lastSeq: lastSeenSyncSeqRef.current });
			} catch (error) {
				if (!cancelled) {
					connectedRef.current = false;
					setConnected(false);
					setConnectionError(getErrorMessage(error));
				}
				return;
			}

			if (cancelled) {
				eventSource.close();
				return;
			}

			eventSource.onopen = () => {
				setConnectionError(null);
			};

			eventSource.onmessage = (event) => {
				const message = parseServerMessage(event.data);
				if (!message) {
					return;
				}

				const serverPayload = message.type === "sync_event" ? message.payload : message;
				if (message.type === "sync_event") {
					if (message.seq <= lastSeenSyncSeqRef.current) {
						return;
					}

					const missedEvents = lastSeenSyncSeqRef.current > 0 && message.seq > lastSeenSyncSeqRef.current + 1;
					lastSeenSyncSeqRef.current = message.seq;
					if (missedEvents) {
						clearBufferedAssistantDeltas();
						requestSessionPageRef.current(0, Math.max(visibleSessionLimitRef.current, SESSION_PAGE_SIZE));
						ensureSessionLoadedRef.current(activeSessionIdRef.current);
					}
				}

				if (handleServerMessage(serverPayload)) {
					return;
				}

				switch (serverPayload.type) {
				case "connected": {
					connectedRef.current = true;
					setConnected(true);
					setConnectionError(null);
					resolvePendingConnectionsRef.current();
					if (runtime.target === "remote" && runtime.capabilities.settings) {
						void runtime.transport.sendMessage({ type: "load_status" }).catch((error) => {
							setAdminStatusError(getErrorMessage(error));
						});
					}
					requestSessionPageRef.current(0, Math.max(visibleSessionLimitRef.current, SESSION_PAGE_SIZE));
					ensureSessionLoadedRef.current(activeSessionIdRef.current);
					break;
				}
				case "disconnected": {
					connectedRef.current = false;
					setConnected(false);
					setStreamRequested(false);
					setConnectionError(serverPayload.message);
					break;
				}
				case "sessions_page": {
					setLoadingMoreSessions(false);
					serverLoadedSessionCountRef.current = serverPayload.offset === 0
						? serverPayload.sessions.length
						: Math.max(serverLoadedSessionCountRef.current, serverPayload.offset + serverPayload.sessions.length);
					setTotalSessionCount(serverPayload.total);
					if (serverPayload.offset === 0 && serverPayload.total === 0) {
						setSessions([]);
						setSessionCache(new Map());
						setCachedTranscriptRevisions(new Map());
						clearBufferedAssistantDeltas();
						activateSessionRef.current(null, { load: false });
						void clearCachedSessions();
						break;
					}
					const pageSessions = serverPayload.sessions.filter((session) => !isScheduledSessionSummary(session));
					const isCompleteSessionList = serverPayload.offset === 0 && serverPayload.sessions.length >= serverPayload.total;
					if (isCompleteSessionList) {
						const authoritativeSessions = pageSessions.map((session) => {
							const existing = sessionsRef.current.find((entry) => entry.id === session.id);
							return existing && existing.revision > session.revision ? existing : session;
						});
						const authoritativeIds = new Set(authoritativeSessions.map((session) => session.id));
						setSessions(authoritativeSessions);
						setSessionCache((previous) => {
							const next = new Map<string, SessionCacheEntry>();
							for (const session of authoritativeSessions) {
								const cached = previous.get(session.id);
								const latestSession = cached && cached.session.revision > session.revision ? cached.session : session;
								next.set(session.id, cached
									? { ...cached, session: latestSession }
									: createSummaryOnlyCacheEntry(session));
							}
							return next;
						});
						setCachedTranscriptRevisions((previous) => new Map(
							Array.from(previous.entries()).filter(([sessionId]) => authoritativeIds.has(sessionId)),
						));
						for (const sessionId of bufferedAssistantDeltasRef.current.keys()) {
							if (!authoritativeIds.has(sessionId)) {
								clearBufferedAssistantDeltas(sessionId);
							}
						}
						if (activeSessionIdRef.current && !authoritativeIds.has(activeSessionIdRef.current)) {
							activateSessionRef.current(null, { load: false });
						} else if (activeSessionIdRef.current) {
							ensureSessionLoadedRef.current(activeSessionIdRef.current);
						}
						void replaceSessionSummaries(authoritativeSessions);
						break;
					}
					setSessions((previous) => {
						let next = previous;
						for (const session of pageSessions) {
							const existing = next.find((entry) => entry.id === session.id);
							next = upsertSessionInList(next, existing && existing.revision > session.revision ? existing : session);
						}
						return next;
					});
					setSessionCache((previous) => {
						const next = new Map(previous);
						for (const session of serverPayload.sessions) {
							const cached = next.get(session.id);
							const latestSession = cached && cached.session.revision > session.revision ? cached.session : session;
							next.set(session.id, cached
								? {
									...cached,
									session: latestSession,
								}
								: createSummaryOnlyCacheEntry(session));
						}
						return next;
					});
					void writeSessionSummaries(serverPayload.sessions);

					const currentActiveSessionId = activeSessionIdRef.current;
					if (currentActiveSessionId) {
						ensureSessionLoadedRef.current(currentActiveSessionId);
					}
					break;
				}
				case "session_summary_updated": {
					if (!isScheduledSessionSummary(serverPayload.session)) {
						if (activeSessionIdRef.current !== serverPayload.session.id) {
							setSessionIdsWithInactiveUpdates((previous) => {
								if (previous.has(serverPayload.session.id)) {
									return previous;
								}
								const next = new Set(previous);
								next.add(serverPayload.session.id);
								return next;
							});
						}
						setSessions((previous) => {
							const existing = previous.find((entry) => entry.id === serverPayload.session.id);
							return upsertSessionInList(
								previous,
								existing && existing.revision > serverPayload.session.revision ? existing : serverPayload.session,
							);
						});
					}
					setSessionCache((previous) => {
						const next = new Map(previous);
						const cached = next.get(serverPayload.session.id);
						const latestSession = cached && cached.session.revision > serverPayload.session.revision ? cached.session : serverPayload.session;
						next.set(serverPayload.session.id, cached
							? {
								...cached,
								session: latestSession,
							}
							: createSummaryOnlyCacheEntry(serverPayload.session));
						return next;
					});
					if (!isScheduledSessionSummary(serverPayload.session)) {
						setTotalSessionCount((previous) => {
							if (previous === null) {
								return Math.max(sessionsRef.current.length, 1);
							}
							const exists = sessionsRef.current.some((session) => session.id === serverPayload.session.id);
							return exists ? previous : previous + 1;
						});
					}
					void writeSessionSummary(serverPayload.session);

					if (activeSessionIdRef.current === serverPayload.session.id && !isScheduledSessionSummary(serverPayload.session)) {
						ensureSessionLoadedRef.current(serverPayload.session.id);
					}
					break;
				}
				case "session_deleted": {
					clearBufferedAssistantDeltas(serverPayload.sessionId);
					setSessionIdsWithInactiveUpdates((previous) => {
						if (!previous.has(serverPayload.sessionId)) {
							return previous;
						}
						const next = new Set(previous);
						next.delete(serverPayload.sessionId);
						return next;
					});
					setSessions((previous) => previous.filter((session) => session.id !== serverPayload.sessionId));
					setSessionCache((previous) => {
						if (!previous.has(serverPayload.sessionId)) {
							return previous;
						}

						const next = new Map(previous);
						next.delete(serverPayload.sessionId);
						return next;
					});
					setCachedTranscriptRevisions((previous) => {
						if (!previous.has(serverPayload.sessionId)) {
							return previous;
						}

						const next = new Map(previous);
						next.delete(serverPayload.sessionId);
						return next;
					});
					setTotalSessionCount((previous) => (previous === null ? null : Math.max(0, previous - 1)));
					if (activeSessionIdRef.current === serverPayload.sessionId) {
						activateSessionRef.current(null, { load: false });
					}
					void deleteCachedSession(serverPayload.sessionId);
					break;
				}
				case "session_created": {
					setConnectionError(null);
					setPendingPrompt(null);
					clearBufferedAssistantDeltas(serverPayload.session.id);
					upsertSessionSnapshotRef.current(serverPayload.session, serverPayload.transcript);
					if (!isScheduledSessionSummary(serverPayload.session)) {
						setTotalSessionCount((previous) => {
							if (previous === null) {
								return Math.max(sessionsRef.current.length, 1);
							}
							const exists = sessionsRef.current.some((session) => session.id === serverPayload.session.id);
							return exists ? previous : previous + 1;
						});
						setPendingDraft(false);
						activateSessionRef.current(serverPayload.session.id, { load: false, focus: false });
					}
					break;
				}
				case "session_snapshot": {
					setConnectionError(null);
					setPendingPrompt((current) =>
						current?.sessionId === serverPayload.session.id && transcriptContainsPrompt(serverPayload.transcript, current.prompt)
							? null
							: current,
					);
					clearBufferedAssistantDeltas(serverPayload.session.id);
					upsertSessionSnapshotRef.current(serverPayload.session, serverPayload.transcript);
					break;
				}
				case "assistant_delta": {
					bufferAssistantDelta(serverPayload.sessionId, {
						messageId: serverPayload.messageId,
						delta: serverPayload.delta,
						field: "body",
						contentIndex: serverPayload.contentIndex,
					});
					break;
				}
				case "assistant_thinking_delta": {
					bufferAssistantDelta(serverPayload.sessionId, {
						messageId: serverPayload.messageId,
						delta: serverPayload.delta,
						field: "thinking",
						contentIndex: serverPayload.contentIndex,
					});
					break;
				}
				case "error": {
					setPendingDraft(false);
					setPendingPrompt(null);
					setConnectionError(serverPayload.message);
					break;
				}
				case "pong": {
					break;
				}
			}
			};

			eventSource.onerror = () => {
				connectedRef.current = false;
				setConnected(false);
				setConnectionError((current) => current ?? STREAM_DISCONNECTED_MESSAGE);
				if (runtime.target === "remote" && !cancelled) {
					window.setTimeout(() => {
						if (!cancelled) {
							setStreamGeneration((current) => current + 1);
						}
					}, 1_000);
				}
			};
		};

		void connect();

		return () => {
			cancelled = true;
			eventSource?.close();
			connectedRef.current = false;
			setConnected(false);
		};
	}, [bufferAssistantDelta, chatTransportReady, clearBufferedAssistantDeltas, handleServerMessage, runtime, streamGeneration, streamRequested]);

	const handleLoadMoreSessions = useCallback(() => {
		const nextVisibleLimit = visibleSessionLimitRef.current + SESSION_PAGE_SIZE;
		setVisibleSessionLimit(nextVisibleLimit);
		if (sessionsRef.current.length >= nextVisibleLimit) {
			return;
		}

		const knownTotal = totalSessionCount ?? sessionsRef.current.length;
		const needsServerPage =
			serverLoadedSessionCountRef.current < nextVisibleLimit &&
			serverLoadedSessionCountRef.current < knownTotal;
		if (!needsServerPage) {
			return;
		}

		setLoadingMoreSessions(true);
		requestSessionPage(serverLoadedSessionCountRef.current, SESSION_PAGE_SIZE);
	}, [requestSessionPage, totalSessionCount]);

	const handleSyncAllChats = useCallback(() => {
		for (const sessionId of sessionIdsNeedingSync) {
			ensureSessionLoaded(sessionId);
		}
	}, [ensureSessionLoaded, sessionIdsNeedingSync]);

	const submitPrompt = useCallback((trimmedPrompt: string) => {
		if (!trimmedPrompt || isBusy || !chatTransportReady) {
			return false;
		}

		setConnectionError(null);
		const nextPendingPrompt = {
			id: createBrowserUuid(),
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
		};
		setPendingPrompt(nextPendingPrompt);
		setPendingDraft(!activeSessionId);
		void sendClientMessage({
			type: "prompt",
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
			userMessageId: `${nextPendingPrompt.id}:user`,
			assistantMessageId: `${nextPendingPrompt.id}:assistant`,
		}).catch((error) => {
			setPendingDraft(false);
			setPendingPrompt((current) => current?.id === nextPendingPrompt.id ? null : current);
			setConnectionError(getErrorMessage(error));
		});
		return true;
	}, [activeSessionId, chatTransportReady, isBusy, sendClientMessage]);

	const handleDeleteSession = useCallback(async (sessionId: string) => {
		const session = sessionsRef.current.find((entry) => entry.id === sessionId);
		if (session?.busy) {
			setConnectionError("Wait for this chat to finish or abort it before deleting.");
			return;
		}

		await sendClientMessage({ type: "delete_session", sessionId });
	}, [sendClientMessage]);

	const handleDeleteAllSessions = useCallback(async () => {
		await sendClientMessage({ type: "delete_all_sessions" });
	}, [sendClientMessage]);

	const handleAbort = useCallback(async () => {
		if (!activeSession?.busy) {
			return;
		}

		setAbortingSessionId(activeSession.id);
		try {
			await sendClientMessage({ type: "abort", sessionId: activeSession.id });
		} catch (error) {
			setConnectionError(getErrorMessage(error));
		} finally {
			setAbortingSessionId((current) => (current === activeSession.id ? null : current));
		}
	}, [activeSession, sendClientMessage]);

	const emptyState = !activeSession
		? {
			title: composerBlockedReason
				? "Sign in required"
				: !relayReady
				? runtime.transport.unavailableTitle
				: !serverReady
				? "Reconnecting..."
				: connected
						? (pendingDraft && !activePendingPrompt ? "Creating session..." : "Ready when you are")
						: streamRequested ? "Connecting..." : "Ready when you are",
			body: composerBlockedReason
				? composerBlockedReason
				: !relayReady
				? (adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody)
				: !serverReady
				? (transportStatusMessage ?? runtime.transport.connectingBody)
				: connected
				? null
				: !streamRequested
					? `Opening the ${runtime.transport.label} event stream.`
					: runtime.transport.connectingBody,
		}
		: !activeTranscriptAvailable
			? {
				title: "Loading session...",
				body: `Fetching the latest transcript from the ${runtime.transport.label}.`,
			}
			: null;
	const canLoadMoreSessions = visibleSessionLimit < Math.max(totalSessionCount ?? 0, sessions.length);
	const selectedJobId = route === "jobs" ? readSelectedJobIdFromRoute() : null;

	const handleRouteChange = useCallback((nextRoute: AppRoute) => {
		const supportedRoute = coerceRouteForCapabilities(nextRoute, effectiveCapabilities);
		navigateToRoute(supportedRoute);
		setRoute(supportedRoute);
	}, [effectiveCapabilities]);

	const handleOpenJob = useCallback((jobId: string) => {
		navigateToRoute("jobs", { jobId });
		setRoute(coerceRouteForCapabilities("jobs", effectiveCapabilities));
		handleRefreshJobRuns(jobId);
	}, [effectiveCapabilities, handleRefreshJobRuns]);



	if (authSessionPending || signInRequired) {
		return <AuthGate pending={authSessionPending} />;
	}

	return (
		<AppRouteView
			route={route}
			adminStatus={adminStatus} adminStatusError={adminStatusError} providers={providers} providersError={providersError}
			mcpServers={mcpServers} mcpServersError={mcpServersError} loadingMcpServers={loadingMcpServers}
			savingAppendPrompt={savingAppendPrompt} appendPromptMessage={appendPromptMessage} appendPromptError={appendPromptError}
			scheduledJobs={scheduledJobs} scheduledJobRuns={scheduledJobRuns} sessionCache={sessionCache}
			scheduledJobsError={scheduledJobsError} scheduledJobRunsError={scheduledJobRunsError}
			loadingScheduledJobs={loadingScheduledJobs} loadingScheduledJobRuns={loadingScheduledJobRuns}
			connectionError={connectionError} pendingDraft={pendingDraft} visibleSessions={visibleSessions}
			sessionIdsNeedingSync={sessionIdsNeedingSync}
			loadingMoreSessions={loadingMoreSessions} canLoadMoreSessions={canLoadMoreSessions}
			activeSessionId={activeSessionId} activeSession={activeSession} activeTranscript={displayedActiveTranscript}
			aborting={aborting}
			emptyState={activePendingPrompt ? null : emptyState} connected={connected} serverReady={serverReady} streamRequested={streamRequested} target={runtime.target}
			composerBlockedReason={composerBlockedReason}
			capabilities={effectiveCapabilities}
			connectionLabel={runtime.transport.label}
			selectedJobId={selectedJobId}
			promptInputRef={promptInputRef}
			onRouteChange={handleRouteChange}
			onOpenJob={handleOpenJob}
			onRefreshJobs={handleRefreshJobs} onRefreshJobRuns={handleRefreshJobRuns}
			onUpdateJobInterval={updateScheduledJob} onToggleJobEnabled={toggleScheduledJobEnabled}
			onDeleteJob={deleteScheduledJob} onEnsureSessionLoaded={ensureSessionLoaded}
			onSetDefaultModel={handleSetDefaultModel} onStartProviderLogin={handleStartProviderLogin}
			onSaveProviderApiKey={handleSaveProviderApiKey} onCreateMcpServer={handleCreateMcpServer}
			onUpdateMcpServer={handleUpdateMcpServer} onDeleteMcpServer={handleDeleteMcpServer}
			onRefreshMcpServers={() => {
				void reloadMcpServers().catch(() => {
					// MCP errors are already captured for rendering.
				});
			}}
			onSaveAppendSystemPrompt={handleSaveAppendSystemPrompt}
			onDeleteAllSessions={handleDeleteAllSessions}
			onStartNewChat={handleStartNewChat} onSyncAllChats={handleSyncAllChats} onActivateSession={activateSession} onLoadMoreSessions={handleLoadMoreSessions}
			onSendPrompt={submitPrompt} onAbort={handleAbort} onDeleteSession={handleDeleteSession}
		/>
	);
}
