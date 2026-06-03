import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProvidersResponse, ScheduledJobDetails, ScheduledJobUpdateRequest } from "@apreal/shared";
import EventSource from "react-native-sse";
import { createContext, useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";

import { ensureRelayClientAuth, readRelayClientHeartbeat, readStoredRelayClientAuth, type RelayPairingStateMessage, type StoredRelayClientAuth } from "@/lib/relay-auth";
import { DEFAULT_TRANSPORT_SETTINGS, getRelayTransportConfig, normalizeStoredTransportSettings, type StoredTransportSettings } from "@/lib/transport-config";
import type { ClientMessage, JobRunSummary, SessionCacheEntry, SessionSummary, ServerMessage, TranscriptMessage, TranscriptMessageSegment } from "@/types/chat";

import { useChatClientRequestActions } from "./use-chat-client-request-actions";
import { useChatClientStartup } from "./use-chat-client-startup";
import { useChatClientStream } from "./use-chat-client-stream";
import { ACTIVE_SESSION_STORAGE_KEY, TRANSPORT_SETTINGS_STORAGE_KEY, SERVER_URL_STORAGE_KEY, SESSION_PAGE_SIZE, STREAM_DISCONNECTED_MESSAGE, STREAM_REQUIRED_MESSAGE, AUTH_REFRESH_INTERVAL_MS, RELAY_HEARTBEAT_INTERVAL_MS, ChatClientContext, createLocalId, cloneTranscript, upsertSessionInList, upsertRunInList, createSummaryOnlyCacheEntry, sortJobs, upsertJobInList, removeJobFromList, removeSessionFromList, getSegmentSortValue, insertSegmentInOrder, getErrorMessage, parseScheduledJobNameFromTitle, isScheduledSessionSummary, isObjectRecord, parseServerMessage, appendAssistantDeltaToMessage, buildPairingState, type ActivateSessionOptions, type ChatClientContextValue } from "./chat-client-utils";
export function ChatClientProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transportSettings, setTransportSettings] = useState(
    DEFAULT_TRANSPORT_SETTINGS,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState(false);
  const [shouldRestoreLastSession, setShouldRestoreLastSession] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [relayAuth, setRelayAuth] = useState<StoredRelayClientAuth | null>(null);
  const [streamRequested, setStreamRequested] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [serverLoadedSessionCount, setServerLoadedSessionCount] = useState(0);
  const [totalSessionCount, setTotalSessionCount] = useState<number | null>(null);
  const [jobs, setJobs] = useState<ScheduledJobDetails[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [jobRunsByJobId, setJobRunsByJobId] = useState<
    Record<string, JobRunSummary[]>
  >({});
  const [loadingJobRunsByJobId, setLoadingJobRunsByJobId] = useState<
    Record<string, boolean>
  >({});

  const eventSourceRef = useRef<EventSource | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const pendingDraftRef = useRef(pendingDraft);
  const sessionsRef = useRef(sessions);
  const sessionCacheRef = useRef(sessionCache);
  const jobsRef = useRef(jobs);
  const loadingJobsRef = useRef(loadingJobs);
  const loadingProvidersRef = useRef(loadingProviders);
  const loadingJobRunsByJobIdRef = useRef(loadingJobRunsByJobId);
  const transportSettingsRef = useRef(transportSettings);
  const pendingConnectionResolversRef = useRef(new Set<() => void>());
  const resolvePendingConnectionsRef = useRef<() => void>(() => {});
  const sendClientMessageRef = useRef<(message: ClientMessage) => Promise<void>>(async () => {});
  const ensureSessionLoadedRef = useRef<(sessionId: string | null) => void>(() => {});
  const requestSessionPageRef = useRef<(offset?: number, limit?: number) => void>(() => {});
  const activateSessionRef = useRef<(sessionId: string | null, options?: ActivateSessionOptions) => void>(() => {});
  const upsertSessionSnapshotRef = useRef<(session: SessionSummary, transcript: TranscriptMessage[]) => void>(() => {});
  const transportConfig = getRelayTransportConfig(transportSettings);

  useChatClientStartup({ activeSessionIdRef, activeSessionId, pendingDraftRef, pendingDraft, sessionsRef, sessions, sessionCacheRef, sessionCache, jobsRef, jobs, loadingJobsRef, loadingJobs, loadingProvidersRef, loadingProviders, loadingJobRunsByJobIdRef, loadingJobRunsByJobId, transportSettingsRef, transportSettings, setTransportSettings, setActiveSessionId, setShouldRestoreLastSession, setIsHydrated, isHydrated });

  function resetRuntimeState() {
    eventSourceRef.current?.removeAllEventListeners();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConnected(false);
    setPendingDraft(false);
    setSessions([]);
    setSessionCache(new Map());
    setServerLoadedSessionCount(0);
    setTotalSessionCount(null);
    setLoadingMoreSessions(false);
    setJobs([]);
    setJobsLoaded(false);
    setLoadingJobs(false);
    setJobRunsByJobId({});
    setLoadingJobRunsByJobId({});
    setRelayAuth(null);
    setStreamRequested(false);
    setShouldRestoreLastSession(false);
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setLastError(null);
  }

  function clearError() {
    setLastError(null);
  }

  function resolvePendingConnections() {
    for (const resolve of pendingConnectionResolversRef.current) {
      resolve();
    }
    pendingConnectionResolversRef.current.clear();
  }

  useEffect(() => {
    resolvePendingConnectionsRef.current = resolvePendingConnections;
  }, [connected]);

  function waitForConnectionAttempt(timeoutMs = 1200) {
    if (connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeoutId);
        pendingConnectionResolversRef.current.delete(finish);
        resolve();
      };

      const timeoutId = setTimeout(finish, timeoutMs);
      pendingConnectionResolversRef.current.add(finish);
    });
  }

  async function ensureClientTransport() {
    if (!relayAuth?.token) {
      throw new Error("Mobile authentication is not ready yet.");
    }

    if (connected) {
      return;
    }

    setStreamRequested(true);
    await waitForConnectionAttempt();
  }

  async function sendClientMessage(message: ClientMessage) {
    if (!relayAuth?.token) {
      throw new Error("Mobile authentication is not ready yet.");
    }

    await ensureClientTransport();

    const performRequest = () =>
      fetch(transportConfig.messageUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${relayAuth.token}`,
          "content-type": "application/json",
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
  }

  useEffect(() => {
    sendClientMessageRef.current = sendClientMessage;
  }, [relayAuth?.token, connected, transportConfig.messageUrl]);

  function requestSessionPage(offset = 0, limit = SESSION_PAGE_SIZE) {
    void sendClientMessage({ type: "load_sessions_page", offset, limit }).catch(
      (error) => {
        setLoadingMoreSessions(false);
        setLastError(getErrorMessage(error));
      },
    );
  }

  useEffect(() => {
    requestSessionPageRef.current = requestSessionPage;
  }, [relayAuth?.token, connected, transportConfig.messageUrl]);

  const {
    refreshJobs,
    refreshProviders,
    refreshJobRuns,
    updateDefaultModel,
    updateScheduledJob,
    deleteScheduledJob,
  } = useChatClientRequestActions({ loadingJobsRef, setLoadingJobs, setLastError, sendClientMessageRef, loadingProvidersRef, setLoadingProviders, loadingJobRunsByJobIdRef, setLoadingJobRunsByJobId, sendClientMessage });

  function ensureSessionLoaded(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    const summary =
      sessionsRef.current.find((session) => session.id === sessionId) ??
      sessionCacheRef.current.get(sessionId)?.session ??
      null;
    const cached = sessionCacheRef.current.get(sessionId);
    if (
      cached?.transcriptLoaded &&
      (!summary || cached.session.revision >= summary.revision)
    ) {
      return;
    }

    void sendClientMessage({ type: "load_session", sessionId }).catch((error) => {
      setLastError(getErrorMessage(error));
    });
  }

  useEffect(() => {
    ensureSessionLoadedRef.current = ensureSessionLoaded;
  }, [relayAuth?.token, connected, transportConfig.messageUrl]);

  function activateSession(
    sessionId: string | null,
    options: ActivateSessionOptions = {},
  ) {
    const { load = true } = options;
    setShouldRestoreLastSession(false);
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setPendingDraft(false);

    if (load && sessionId) {
      ensureSessionLoaded(sessionId);
    }
  }

  function consumeLastSessionRestore() {
    setShouldRestoreLastSession(false);
  }

  useEffect(() => {
    activateSessionRef.current = activateSession;
  }, [relayAuth?.token, connected, transportConfig.messageUrl]);

  function findScheduledJobIdForSession(session: { title: string }) {
    const jobName = parseScheduledJobNameFromTitle(session.title);
    if (!jobName) {
      return null;
    }

    return jobsRef.current.find((job) => job.name === jobName)?.id ?? null;
  }

  function upsertJobRunForSession(session: JobRunSummary) {
    const jobId = findScheduledJobIdForSession(session);
    if (!jobId) {
      return;
    }

    setJobRunsByJobId((previous) => ({
      ...previous,
      [jobId]: upsertRunInList(previous[jobId] ?? [], session),
    }));
  }

  function removeRunLocally(sessionId: string) {
    setJobRunsByJobId((previous) => {
      let changed = false;
      const next: Record<string, JobRunSummary[]> = {};

      for (const [jobId, runs] of Object.entries(previous)) {
        const filteredRuns = runs.filter((run) => run.id !== sessionId);
        if (filteredRuns.length !== runs.length) {
          changed = true;
        }

        if (filteredRuns.length > 0) {
          next[jobId] = filteredRuns;
        }
      }

      return changed ? next : previous;
    });
  }

  function upsertSessionSnapshot(
    session: SessionSummary,
    transcript: TranscriptMessage[],
  ) {
    setSessionCache((previous) => {
      const nextCache = new Map(previous);
      nextCache.set(session.id, {
        session,
        transcript: cloneTranscript(transcript),
        transcriptLoaded: true,
      });
      return nextCache;
    });

    if (!isScheduledSessionSummary(session)) {
      setSessions((previous) => upsertSessionInList(previous, session));
      return;
    }

    upsertJobRunForSession(session);
  }

  useEffect(() => {
    upsertSessionSnapshotRef.current = upsertSessionSnapshot;
  }, []);

  const requestSessionSnapshot = useCallback((sessionId: string | null) => {
    ensureSessionLoadedRef.current(sessionId);
  }, []);

  function getSessionCacheEntry(sessionId: string) {
    return sessionCache.get(sessionId) ?? null;
  }

  function applyAssistantDelta(
    sessionId: string,
    messageId: string,
    delta: string,
    field: "body" | "thinking",
    contentIndex: number,
  ) {
    setSessionCache((previous) => {
      const cached = previous.get(sessionId);
      if (!cached) {
        return previous;
      }

      const messageIndex = cached.transcript.findIndex(
        (entry) => entry.id === messageId,
      );
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
        delta,
        field,
        contentIndex,
      );

      const nextCache = new Map(previous);
      nextCache.set(sessionId, {
        ...cached,
        transcript,
      });
      return nextCache;
    });
  }

  function updateTransportSettings(nextSettings: StoredTransportSettings) {
    resetRuntimeState();
    setTransportSettings(normalizeStoredTransportSettings(nextSettings));
  }

  function markSessionBusy(sessionId: string) {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              busy: true,
              updatedAt: Date.now(),
            }
          : session,
      ),
    );

    setSessionCache((previous) => {
      const cached = previous.get(sessionId);
      if (!cached) {
        return previous;
      }

      const nextCache = new Map(previous);
      nextCache.set(sessionId, {
        ...cached,
        session: {
          ...cached.session,
          busy: true,
          updatedAt: Date.now(),
        },
      });
      return nextCache;
    });
  }

  function sendPrompt(prompt: string, sessionId = activeSessionIdRef.current) {
    const trimmedPrompt = prompt.trim();
    const activeSession = sessionId
      ? (sessionsRef.current.find((session) => session.id === sessionId) ??
        null)
      : null;

    if (
      !trimmedPrompt ||
      pendingDraftRef.current ||
      Boolean(activeSession?.busy) ||
      !relayAuth?.target?.id
    ) {
      return false;
    }

    setLastError(null);
    setPendingDraft(!sessionId);
    if (sessionId) {
      markSessionBusy(sessionId);
    }

    void sendClientMessage({
      type: "prompt",
      prompt: trimmedPrompt,
      sessionId,
    }).catch((error) => {
      setPendingDraft(false);
      setLastError(getErrorMessage(error));
    });

    return true;
  }

  function abortSession(sessionId: string) {
    if (!relayAuth?.target?.id) {
      return;
    }

    void sendClientMessage({ type: "abort", sessionId }).catch((error) => {
      setLastError(getErrorMessage(error));
    });
  }

  function removeSessionLocally(sessionId: string) {
    setSessions((previous) => removeSessionFromList(previous, sessionId));
    setSessionCache((previous) => {
      if (!previous.has(sessionId)) {
        return previous;
      }

      const nextCache = new Map(previous);
      nextCache.delete(sessionId);
      return nextCache;
    });
    setTotalSessionCount((previous) => {
      if (previous === null) {
        return null;
      }

      const sessionExists = sessionsRef.current.some((session) => session.id === sessionId);
      return sessionExists ? Math.max(0, previous - 1) : previous;
    });

    if (activeSessionIdRef.current === sessionId) {
      activateSessionRef.current(null, { load: false });
    }
  }

  async function deleteSession(sessionId: string) {
    removeSessionLocally(sessionId);
    setLastError(null);

    try {
      await sendClientMessage({ type: "delete_session", sessionId });
    } catch (error) {
      setLastError(getErrorMessage(error));
    }
  }

  function loadMoreSessions() {
    if (loadingMoreSessions) {
      return;
    }

    const knownTotal = totalSessionCount ?? sessionsRef.current.length;
    if (serverLoadedSessionCount >= knownTotal) {
      return;
    }

    setLoadingMoreSessions(true);
    requestSessionPage(serverLoadedSessionCount, SESSION_PAGE_SIZE);
  }

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    setConnected(false);
    setRelayAuth(null);
    setStreamRequested(false);
    setServerLoadedSessionCount(0);
    setTotalSessionCount(null);
    setJobs([]);
    setJobsLoaded(false);
    setLoadingJobs(false);
    setJobRunsByJobId({});
    setLoadingJobRunsByJobId({});

    const refreshRelayAuth = async () => {
      try {
        const nextAuth = await ensureRelayClientAuth(transportConfig.relayUrl);
        if (cancelled) {
          return;
        }

        setRelayAuth(nextAuth);
        if (!nextAuth.target) {
          setConnected(false);
          setLastError(null);
          refreshTimer = setTimeout(refreshRelayAuth, AUTH_REFRESH_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setConnected(false);
        setLastError(getErrorMessage(error));
        refreshTimer = setTimeout(refreshRelayAuth, AUTH_REFRESH_INTERVAL_MS);
      }
    };

    void (async () => {
      const storedAuth = await readStoredRelayClientAuth(transportConfig.relayUrl);
      if (cancelled) {
        return;
      }

      if (storedAuth) {
        setRelayAuth(storedAuth);
      }

      await refreshRelayAuth();
    })();

    return () => {
      cancelled = true;
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
    };
  }, [isHydrated, transportConfig.relayUrl]);

  useEffect(() => {
    if (!relayAuth) {
      return;
    }

    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const pollHeartbeat = async () => {
      try {
        const heartbeat = await readRelayClientHeartbeat(transportConfig.relayUrl);
        if (cancelled) {
          return;
        }

        setRelayAuth(heartbeat.auth);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setConnected(false);
        setLastError((current) => current ?? getErrorMessage(error));
      } finally {
        if (!cancelled) {
          heartbeatTimer = setTimeout(
            pollHeartbeat,
            RELAY_HEARTBEAT_INTERVAL_MS,
          );
        }
      }
    };

    void pollHeartbeat();

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) {
        clearTimeout(heartbeatTimer);
      }
    };
  }, [relayAuth?.clientId, relayAuth?.clientKey, transportConfig.relayUrl]);

  const pairingReady = Boolean(relayAuth?.target?.id);

  useChatClientStream({ relayAuth, pairingReady, setStreamRequested, streamRequested, setConnected, transportConfig, eventSourceRef, setLastError, resolvePendingConnectionsRef, requestSessionPageRef, ensureSessionLoadedRef, activeSessionIdRef, setLoadingMoreSessions, setServerLoadedSessionCount, setTotalSessionCount, setSessions, setSessionCache, upsertJobRunForSession, sessionsRef, setPendingDraft, activateSessionRef, upsertSessionSnapshotRef, removeSessionLocally, removeRunLocally, setLoadingJobs, setJobsLoaded, setJobs, setJobRunsByJobId, setLoadingProviders, setProvidersLoaded, setProviders, setLoadingJobRunsByJobId, applyAssistantDelta });

  const pairingState = buildPairingState(relayAuth);
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    (activeSessionId ? sessionCache.get(activeSessionId)?.session ?? null : null);
  const activeSessionCacheEntry = activeSessionId
    ? sessionCache.get(activeSessionId) ?? null
    : null;
  const activeTranscript = activeSessionCacheEntry?.transcriptLoaded
    ? activeSessionCacheEntry.transcript
    : [];
  const activeTranscriptLoaded =
    activeSessionCacheEntry?.transcriptLoaded ?? false;
  const canLoadMoreSessions =
    totalSessionCount !== null && serverLoadedSessionCount < totalSessionCount;

  return (
    <ChatClientContext.Provider
      value={{
        isHydrated,
        connected,
        transportSettings,
        connectionLabel: transportConfig.label,
        serverUrl: transportConfig.relayUrl,
        pairingState,
        pairingReady,
        sessions,
        totalSessionCount,
        activeSessionId,
        pendingDraft,
        activeSession,
        activeTranscript,
        activeTranscriptLoaded,
        shouldRestoreLastSession,
        lastError,
        loadingMoreSessions,
        canLoadMoreSessions,
        jobs,
        jobsLoaded,
        loadingJobs,
        providers,
        providersLoaded,
        loadingProviders,
        jobRunsByJobId,
        loadingJobRunsByJobId,
        activateSession,
        consumeLastSessionRestore,
        updateTransportSettings,
        requestSessionSnapshot,
        loadMoreSessions,
        refreshJobs,
        refreshProviders,
        refreshJobRuns,
        updateDefaultModel,
        updateScheduledJob,
        deleteScheduledJob,
        getSessionCacheEntry,
        sendPrompt,
        abortSession,
        deleteSession,
        clearError,
      }}
    >
      {children}
    </ChatClientContext.Provider>
  );
}

export { useChatClient } from "./use-chat-client";
