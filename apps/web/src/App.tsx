import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_CLIENT_ID_QUERY_PARAM } from "@apreal/shared";
import { AppRouteView } from "./AppRouteView";
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
	isObjectRecord,
	isScheduledSessionSummary,
	navigateToRoute,
	parseServerMessage,
	readCurrentRoute,
	readStoredSessionId,
	storeActiveSessionId,
	transportConfig,
	upsertSessionInList,
	type AppRoute,
	type ClientMessage,
} from "./app-state";
import { useAppAdmin } from "./useAppAdmin";
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
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [streamRequested, setStreamRequested] = useState(false);
	const {
		adminStatus, adminStatusError, providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		settingsMessage, settingsError, submittingPairingCode, appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSubmitPairingCode, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
	} = useAppAdmin({ route, setConnected, setStreamRequested });
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
	const canLoadMoreSessions = visibleSessionLimit < Math.max(totalSessionCount ?? 0, sessions.length);

	const handleRouteChange = useCallback((nextRoute: AppRoute) => {
		navigateToRoute(nextRoute);
		setRoute(nextRoute);
	}, []);



	return (
		<AppRouteView
			route={route}
			adminStatus={adminStatus} adminStatusError={adminStatusError} providers={providers} providersError={providersError}
			mcpServers={mcpServers} mcpServersError={mcpServersError} loadingMcpServers={loadingMcpServers}
			submittingPairingCode={submittingPairingCode} settingsMessage={settingsMessage} settingsError={settingsError}
			savingAppendPrompt={savingAppendPrompt} appendPromptMessage={appendPromptMessage} appendPromptError={appendPromptError}
			scheduledJobs={scheduledJobs} scheduledJobRuns={scheduledJobRuns} sessionCache={sessionCache}
			scheduledJobsError={scheduledJobsError} scheduledJobRunsError={scheduledJobRunsError}
			loadingScheduledJobs={loadingScheduledJobs} loadingScheduledJobRuns={loadingScheduledJobRuns}
			connectionError={connectionError} pendingDraft={pendingDraft} visibleSessions={visibleSessions}
			loadingMoreSessions={loadingMoreSessions} canLoadMoreSessions={canLoadMoreSessions}
			activeSessionId={activeSessionId} activeSession={activeSession} activeTranscript={activeTranscript}
			emptyState={emptyState} connected={connected} serverReady={serverReady} streamRequested={streamRequested}
			connectionLabel={transportConfig.label}
			promptInputRef={promptInputRef}
			transcriptRef={transcriptRef}
			onRouteChange={handleRouteChange}
			onRefreshAdminStatus={() => {
				void refreshAdminStatus().catch((error) => {
					setAdminStatus(null);
					setAdminStatusError(getErrorMessage(error));
				});
			}}
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
			onSubmitPairingCode={handleSubmitPairingCode} onSaveAppendSystemPrompt={handleSaveAppendSystemPrompt}
			onStartNewChat={handleStartNewChat} onActivateSession={activateSession} onLoadMoreSessions={handleLoadMoreSessions}
			onSendPrompt={submitPrompt} onAbort={handleAbort}
		/>
	);
}
