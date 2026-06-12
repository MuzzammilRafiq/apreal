import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRouteView } from "./AppRouteView";
import { authClient } from "./auth/auth-client";
import { AuthGate } from "./components/AuthGate";
import type { ScheduledJobDetails, SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import {
	clearCachedSessions,
	deleteCachedSession,
	readCachedSessionSnapshot,
	readCachedSessionSummaries,
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
import { coerceRouteForCapabilities, type WebRuntime } from "./runtime";
import { useAppAdmin } from "./useAppAdmin";

type AppProps = {
	runtime: WebRuntime;
};

export function App({ runtime }: AppProps) {
	const { data: authSession, isPending: authSessionPending } = authClient.useSession();
	const [route, setRoute] = useState<AppRoute>(() => coerceRouteForCapabilities(readCurrentRoute(), runtime.capabilities));
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [visibleSessionLimit, setVisibleSessionLimit] = useState(SESSION_PAGE_SIZE);
	const [serverLoadedSessionCount, setServerLoadedSessionCount] = useState(0);
	const [totalSessionCount, setTotalSessionCount] = useState<number | null>(null);
	const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [streamRequested, setStreamRequested] = useState(false);
	const [streamGeneration, setStreamGeneration] = useState(0);
	const signedIn = Boolean(authSession?.user);
	const signInRequired = !authSessionPending && !signedIn;
	const {
		adminStatus, adminStatusError, transportStatusMessage, transportReady, providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		authorizedSettingsSections,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
		handleServerMessage,
	} = useAppAdmin({ route, runtime, enabled: signedIn, setConnected, setStreamRequested });
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

	const visibleSessions = sessions.slice(0, visibleSessionLimit);
	const cachedActiveSession = activeSessionId ? sessionCache.get(activeSessionId)?.session ?? null : null;
	const activeSession =
		sessions.find((session) => session.id === activeSessionId) ??
		(cachedActiveSession && !isScheduledSessionSummary(cachedActiveSession) ? cachedActiveSession : null);
	const activeSessionCacheEntry = activeSessionId ? sessionCache.get(activeSessionId) ?? null : null;
	const activeTranscriptLoaded = Boolean(
		activeSessionCacheEntry?.transcriptLoaded &&
		(!activeSession || (activeSessionCacheEntry.transcriptRevision ?? -1) >= activeSession.revision),
	);
	const activeTranscript = activeTranscriptLoaded ? activeSessionCacheEntry?.transcript ?? [] : [];
	const sessionIdsNeedingSync = useMemo(() => {
		const ids = new Set<string>();
		for (const session of sessions) {
			const cached = sessionCache.get(session.id);
			if (!cached?.transcriptLoaded || (cached.transcriptRevision ?? -1) < session.revision) {
				ids.add(session.id);
			}
		}
		return ids;
	}, [sessionCache, sessions]);
	const serverReady = transportReady;
	const effectiveCapabilities = useMemo(() => ({
		...runtime.capabilities,
		settings: authorizedSettingsSections.length > 0,
		settingsSections: authorizedSettingsSections,
	}), [authorizedSettingsSections, runtime.capabilities]);
	const composerBlockedReason = authSessionPending ? "Checking your sign-in status..." : null;
	const chatTransportReady = serverReady && !composerBlockedReason;
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

	const waitForNextConnectionAttempt = useCallback((timeoutMs = 1200) => new Promise<void>((resolve) => {
		let timeoutId = 0;
		const finish = () => {
			window.clearTimeout(timeoutId);
			pendingConnectionResolversRef.current.delete(finish);
			resolve();
		};

		timeoutId = window.setTimeout(finish, timeoutMs);
		pendingConnectionResolversRef.current.add(finish);
	}), []);

	const restartEventStream = useCallback(() => {
		setConnected(false);
		setStreamRequested(true);
		setStreamGeneration((current) => current + 1);
	}, []);

	const ensureClientTransport = useCallback(async () => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody);
		}

		if (connected) {
			return;
		}

		setStreamRequested(true);
		await waitForConnectionAttempt();
	}, [adminStatusError, connected, runtime, serverReady, transportStatusMessage, waitForConnectionAttempt]);

	const sendClientMessage = useCallback(async (message: ClientMessage) => {
		if (!serverReady) {
			throw new Error(adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody);
		}

		await ensureClientTransport();

		try {
			await runtime.transport.sendMessage(message);
		} catch (error) {
			if (getErrorMessage(error) === STREAM_REQUIRED_MESSAGE) {
				restartEventStream();
				await waitForNextConnectionAttempt(2_000);
				await runtime.transport.sendMessage(message);
				return;
			}
			throw error;
		}
	}, [adminStatusError, ensureClientTransport, restartEventStream, runtime, serverReady, transportStatusMessage, waitForNextConnectionAttempt]);

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

				upsertSessionSnapshotRef.current(cachedSnapshot.session, cachedSnapshot.transcript, { persist: false });
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

	const upsertSessionSnapshot = useCallback((
		session: SessionSummary,
		transcript: TranscriptMessage[],
		options: { persist?: boolean } = {},
	) => {
		setSessionCache((previous) => {
			const next = new Map(previous);
			const cached = next.get(session.id);
			const latestSession = cached && cached.session.revision > session.revision ? cached.session : session;
			next.set(session.id, {
				session: latestSession,
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
			void writeSessionSnapshot(session, transcript);
		}
	}, []);

	useEffect(() => {
		upsertSessionSnapshotRef.current = upsertSessionSnapshot;
	}, [upsertSessionSnapshot]);

	const handleStartNewChat = useCallback(() => {
		activateSession(null, { load: false });
	}, [activateSession]);


	useEffect(() => {
		if (chatTransportReady) {
			setStreamRequested(true);
			return;
		}

		setStreamRequested(false);
		setConnected(false);
	}, [chatTransportReady]);

	useEffect(() => {
		if (!chatTransportReady || !streamRequested) {
			setConnected(false);
			return;
		}

		let eventSource: EventSource | null = null;
		let cancelled = false;

		const connect = async () => {
			try {
				eventSource = await runtime.transport.openEventStream();
			} catch (error) {
				if (!cancelled) {
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
				setConnected(true);
				setConnectionError(null);
				resolvePendingConnectionsRef.current();
			};

			eventSource.onmessage = (event) => {
			const message = parseServerMessage(event.data);
			if (!message) {
				return;
			}

			if (handleServerMessage(message)) {
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
				case "disconnected": {
					setConnected(false);
					setStreamRequested(false);
					setConnectionError(message.message);
					break;
				}
				case "sessions_page": {
					setLoadingMoreSessions(false);
					setServerLoadedSessionCount((previous) => Math.max(previous, message.offset + message.sessions.length));
					setTotalSessionCount(message.total);
					if (message.offset === 0 && message.total === 0) {
						setSessions([]);
						setSessionCache(new Map());
						activateSessionRef.current(null, { load: false });
						void clearCachedSessions();
						break;
					}
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
				case "session_deleted": {
					setSessions((previous) => previous.filter((session) => session.id !== message.sessionId));
					setSessionCache((previous) => {
						if (!previous.has(message.sessionId)) {
							return previous;
						}

						const next = new Map(previous);
						next.delete(message.sessionId);
						return next;
					});
					setTotalSessionCount((previous) => (previous === null ? null : Math.max(0, previous - 1)));
					if (activeSessionIdRef.current === message.sessionId) {
						activateSessionRef.current(null, { load: false });
					}
					void deleteCachedSession(message.sessionId);
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
		};

		void connect();

		return () => {
			cancelled = true;
			eventSource?.close();
			setConnected(false);
		};
	}, [chatTransportReady, handleServerMessage, runtime, streamGeneration, streamRequested]);

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
		if (!trimmedPrompt || isBusy || !chatTransportReady) {
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
	}, [activeSessionId, chatTransportReady, focusPrompt, isBusy, sendClientMessage]);

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
			title: composerBlockedReason
				? "Sign in required"
				: !serverReady
				? runtime.transport.unavailableTitle
				: connected
						? (pendingDraft ? "Creating session..." : "Ready when you are")
						: streamRequested ? "Connecting..." : "Ready when you are",
			body: composerBlockedReason
				? composerBlockedReason
				: !serverReady
				? (adminStatusError ?? transportStatusMessage ?? runtime.transport.unavailableBody)
				: connected
				? "Start with a coding task, file request, or bug report. The first prompt creates a reusable session that stays available in the left rail."
				: !streamRequested
					? `Opening the ${runtime.transport.label} event stream.`
					: runtime.transport.connectingBody,
		}
		: !activeTranscriptLoaded
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
	}, [effectiveCapabilities]);



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
			activeSessionId={activeSessionId} activeSession={activeSession} activeTranscript={activeTranscript}
			emptyState={emptyState} connected={connected} serverReady={serverReady} streamRequested={streamRequested} target={runtime.target}
			composerBlockedReason={composerBlockedReason}
			capabilities={effectiveCapabilities}
			connectionLabel={runtime.transport.label}
			selectedJobId={selectedJobId}
			promptInputRef={promptInputRef}
			transcriptRef={transcriptRef}
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
			onStartNewChat={handleStartNewChat} onActivateSession={activateSession} onLoadMoreSessions={handleLoadMoreSessions}
			onSendPrompt={submitPrompt} onAbort={handleAbort} onDeleteSession={handleDeleteSession}
		/>
	);
}
