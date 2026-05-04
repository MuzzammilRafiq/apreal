import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ScheduledJobDetails,
  ScheduledJobUpdateRequest,
} from "@apreal/shared";
import EventSource from "react-native-sse";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  ensureRelayClientAuth,
  readRelayClientHeartbeat,
  readStoredRelayClientAuth,
  type RelayPairingStateMessage,
  type StoredRelayClientAuth,
} from "@/lib/relay-auth";
import {
  DEFAULT_TRANSPORT_SETTINGS,
  getRelayTransportConfig,
  normalizeStoredTransportSettings,
  type StoredTransportSettings,
} from "@/lib/transport-config";
import type {
  ClientMessage,
  JobRunSummary,
  SessionCacheEntry,
  SessionSummary,
  ServerMessage,
  TranscriptMessage,
  TranscriptMessageSegment,
} from "@/types/chat";

const ACTIVE_SESSION_STORAGE_KEY = "pi-mobile-active-session";
const TRANSPORT_SETTINGS_STORAGE_KEY = "pi-mobile-transport-settings";
const SERVER_URL_STORAGE_KEY = "pi-mobile-server-url";
const SESSION_PAGE_SIZE = 50;
const STREAM_DISCONNECTED_MESSAGE =
  "Disconnected from the server stream. Reconnecting...";
const STREAM_REQUIRED_MESSAGE = "Client event stream is not connected.";
const AUTH_REFRESH_INTERVAL_MS = 3_000;
const RELAY_HEARTBEAT_INTERVAL_MS = 500;

type ActivateSessionOptions = {
  load?: boolean;
};

type ChatClientContextValue = {
  isHydrated: boolean;
  connected: boolean;
  transportSettings: StoredTransportSettings;
  connectionLabel: string;
  serverUrl: string;
  pairingState: RelayPairingStateMessage | null;
  pairingReady: boolean;
  sessions: SessionSummary[];
  totalSessionCount: number | null;
  activeSessionId: string | null;
  pendingDraft: boolean;
  activeSession: SessionSummary | null;
  activeTranscript: TranscriptMessage[];
  activeTranscriptLoaded: boolean;
  shouldRestoreLastSession: boolean;
  lastError: string | null;
  loadingMoreSessions: boolean;
  canLoadMoreSessions: boolean;
  jobs: ScheduledJobDetails[];
  jobsLoaded: boolean;
  loadingJobs: boolean;
  jobRunsByJobId: Record<string, JobRunSummary[]>;
  loadingJobRunsByJobId: Record<string, boolean>;
  activateSession: (
    sessionId: string | null,
    options?: ActivateSessionOptions,
  ) => void;
  consumeLastSessionRestore: () => void;
  updateTransportSettings: (settings: StoredTransportSettings) => void;
  requestSessionSnapshot: (sessionId: string | null) => void;
  loadMoreSessions: () => void;
  refreshJobs: () => Promise<void>;
  refreshJobRuns: (jobId: string) => Promise<void>;
  updateScheduledJob: (
    jobId: string,
    changes: ScheduledJobUpdateRequest,
  ) => Promise<void>;
  deleteScheduledJob: (jobId: string) => Promise<void>;
  getSessionCacheEntry: (sessionId: string) => SessionCacheEntry | null;
  sendPrompt: (prompt: string, sessionId?: string | null) => boolean;
  abortSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  clearError: () => void;
};

const ChatClientContext = createContext<ChatClientContextValue | null>(null);

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
  return transcript.map((entry) => ({
    ...entry,
    toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
    segments: entry.segments.map((segment) => ({ ...segment })),
  }));
}

function upsertSessionInList(
  sessions: SessionSummary[],
  session: SessionSummary,
) {
  const nextSessions = sessions.filter((entry) => entry.id !== session.id);
  nextSessions.push(session);
  nextSessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return nextSessions;
}

function upsertRunInList(runs: JobRunSummary[], run: JobRunSummary) {
  const nextRuns = runs.filter((entry) => entry.id !== run.id);
  nextRuns.push(run);
  nextRuns.sort((left, right) => right.updatedAt - left.updatedAt);
  return nextRuns;
}

function createSummaryOnlyCacheEntry(session: SessionSummary): SessionCacheEntry {
  return {
    session,
    transcript: [],
    transcriptLoaded: false,
  };
}

function sortJobs(jobs: ScheduledJobDetails[]): ScheduledJobDetails[] {
  return [...jobs].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return Number(right.enabled) - Number(left.enabled);
    }

    return left.nextRunAt - right.nextRunAt || left.name.localeCompare(right.name);
  });
}

function upsertJobInList(
  jobs: ScheduledJobDetails[],
  job: ScheduledJobDetails,
): ScheduledJobDetails[] {
  return sortJobs([...jobs.filter((entry) => entry.id !== job.id), job]);
}

function removeJobFromList(
  jobs: ScheduledJobDetails[],
  jobId: string,
): ScheduledJobDetails[] {
  return jobs.filter((entry) => entry.id !== jobId);
}

function removeSessionFromList(
  sessions: SessionSummary[],
  sessionId: string,
): SessionSummary[] {
  return sessions.filter((entry) => entry.id !== sessionId);
}

function getSegmentSortValue(segment: TranscriptMessageSegment) {
  return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

function insertSegmentInOrder(
  segments: TranscriptMessage["segments"],
  segment: TranscriptMessage["segments"][number],
) {
  const nextSegments = [...segments];
  const insertIndex = nextSegments.findIndex(
    (entry) => getSegmentSortValue(entry) > getSegmentSortValue(segment),
  );

  if (insertIndex === -1) {
    nextSegments.push(segment);
    return nextSegments;
  }

  nextSegments.splice(insertIndex, 0, segment);
  return nextSegments;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to connect right now.";
}

function parseScheduledJobNameFromTitle(title: string): string | null {
  const match = /^\[Scheduled: ([^\]]+)\]/.exec(title);
  return match?.[1] ?? null;
}

function isScheduledSessionSummary(session: { title: string }): boolean {
  return parseScheduledJobNameFromTitle(session.title) !== null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function appendAssistantDeltaToMessage(
  message: TranscriptMessage,
  delta: string,
  field: "body" | "thinking",
  contentIndex: number,
): TranscriptMessage {
  const now = Date.now();
  const segmentType = field === "thinking" ? "thinking" : "text";
  const existingSegmentIndex = message.segments.findIndex(
    (segment) =>
      segment.type === segmentType && segment.contentIndex === contentIndex,
  );

  let segments = message.segments;
  if (existingSegmentIndex >= 0) {
    segments = [...message.segments];
    const existingSegment = segments[existingSegmentIndex];
    if (existingSegment?.type === segmentType) {
      segments[existingSegmentIndex] = {
        ...existingSegment,
        content: `${existingSegment.content}${delta}`,
        updatedAt: now,
      };
    }
  } else {
    segments = insertSegmentInOrder(message.segments, {
      id: createLocalId(segmentType),
      type: segmentType,
      content: delta,
      contentIndex,
      createdAt: now,
      updatedAt: now,
    });
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

function buildPairingState(
  auth: StoredRelayClientAuth | null,
): RelayPairingStateMessage | null {
  if (!auth) {
    return null;
  }

  return {
    type: "pairing_state",
    status: auth.target ? "paired" : "pending",
    clientId: auth.clientId,
    pairingCode: auth.pairingCode,
    agentId: auth.target?.id ?? null,
    expiresAt: auth.expiresAt || null,
  };
}

export function ChatClientProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transportSettings, setTransportSettings] = useState(
    DEFAULT_TRANSPORT_SETTINGS,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCache, setSessionCache] = useState<
    Map<string, SessionCacheEntry>
  >(() => new Map());
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
  const loadingJobRunsByJobIdRef = useRef(loadingJobRunsByJobId);
  const transportSettingsRef = useRef(transportSettings);
  const pendingConnectionResolversRef = useRef(new Set<() => void>());
  const resolvePendingConnectionsRef = useRef<() => void>(() => {});
  const sendClientMessageRef = useRef<(message: ClientMessage) => Promise<void>>(
    async () => {},
  );
  const ensureSessionLoadedRef = useRef<(sessionId: string | null) => void>(
    () => {},
  );
  const requestSessionPageRef = useRef<
    (offset?: number, limit?: number) => void
  >(() => {});
  const activateSessionRef = useRef<
    (sessionId: string | null, options?: ActivateSessionOptions) => void
  >(() => {});
  const upsertSessionSnapshotRef = useRef<
    (session: SessionSummary, transcript: TranscriptMessage[]) => void
  >(() => {});
  const transportConfig = getRelayTransportConfig(transportSettings);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    pendingDraftRef.current = pendingDraft;
  }, [pendingDraft]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    sessionCacheRef.current = sessionCache;
  }, [sessionCache]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    loadingJobsRef.current = loadingJobs;
  }, [loadingJobs]);

  useEffect(() => {
    loadingJobRunsByJobIdRef.current = loadingJobRunsByJobId;
  }, [loadingJobRunsByJobId]);

  useEffect(() => {
    transportSettingsRef.current = transportSettings;
  }, [transportSettings]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [storedTransportSettings, storedLegacyServerUrl, storedActiveSessionId] =
          await Promise.all([
            AsyncStorage.getItem(TRANSPORT_SETTINGS_STORAGE_KEY),
            AsyncStorage.getItem(SERVER_URL_STORAGE_KEY),
            AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY),
          ]);

        if (cancelled) {
          return;
        }

        if (storedTransportSettings?.trim()) {
          try {
            const parsed = JSON.parse(storedTransportSettings) as
              | Record<string, unknown>
              | null;
            const legacyLocalServerUrl =
              typeof parsed?.localServerUrl === "string"
                ? parsed.localServerUrl
                : undefined;
            const relayUrl =
              typeof parsed?.relayUrl === "string" ? parsed.relayUrl : undefined;
            const relayWebSocketUrl =
              typeof parsed?.relayWebSocketUrl === "string"
                ? parsed.relayWebSocketUrl
                : undefined;
            const relayBootstrapUrl =
              typeof parsed?.relayBootstrapUrl === "string"
                ? parsed.relayBootstrapUrl
                : undefined;

            setTransportSettings(
              normalizeStoredTransportSettings({
                relayUrl:
                  relayUrl ??
                  relayBootstrapUrl ??
                  relayWebSocketUrl ??
                  storedLegacyServerUrl ??
                  legacyLocalServerUrl,
              }),
            );
          } catch {
            setTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
          }
        } else if (storedLegacyServerUrl?.trim()) {
          setTransportSettings(
            normalizeStoredTransportSettings({
              relayUrl: storedLegacyServerUrl.trim(),
            }),
          );
        }

        if (storedActiveSessionId?.trim()) {
          setActiveSessionId(storedActiveSessionId);
          activeSessionIdRef.current = storedActiveSessionId;
          setShouldRestoreLastSession(true);
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.multiSet([
      [
        TRANSPORT_SETTINGS_STORAGE_KEY,
        JSON.stringify(transportSettingsRef.current),
      ],
      [SERVER_URL_STORAGE_KEY, transportSettingsRef.current.relayUrl],
    ]);
  }, [isHydrated, transportSettings]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (activeSessionId) {
      void AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      return;
    }

    void AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, [activeSessionId, isHydrated]);

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

  const refreshJobs = useCallback(async () => {
    if (loadingJobsRef.current) {
      return;
    }

    setLoadingJobs((previous) => (previous ? previous : true));
    setLastError(null);

    try {
      await sendClientMessageRef.current({ type: "load_jobs" });
    } catch (error) {
      setLoadingJobs(false);
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }, []);

  const refreshJobRuns = useCallback(async (jobId: string) => {
    if (loadingJobRunsByJobIdRef.current[jobId]) {
      return;
    }

    setLoadingJobRunsByJobId((previous) => {
      if (previous[jobId]) {
        return previous;
      }

      return {
        ...previous,
        [jobId]: true,
      };
    });
    setLastError(null);

    try {
      await sendClientMessageRef.current({ type: "load_job_runs", jobId });
    } catch (error) {
      setLoadingJobRunsByJobId((previous) => {
        if (!previous[jobId]) {
          return previous;
        }

        return {
          ...previous,
          [jobId]: false,
        };
      });
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }, []);

  async function updateScheduledJob(
    jobId: string,
    changes: ScheduledJobUpdateRequest,
  ) {
    setLastError(null);

    try {
      await sendClientMessage({
        type: "update_job",
        jobId,
        changes,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }

  async function deleteScheduledJob(jobId: string) {
    setLastError(null);

    try {
      await sendClientMessage({ type: "delete_job", jobId });
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }

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

  useEffect(() => {
    if (relayAuth?.token && pairingReady) {
      setStreamRequested(true);
    }
  }, [pairingReady, relayAuth?.token]);

  useEffect(() => {
    if (!relayAuth?.token || !pairingReady || !streamRequested) {
      setConnected(false);
      return;
    }

    const streamUrl = new URL(transportConfig.streamUrl);
    streamUrl.searchParams.set("token", relayAuth.token);

    const eventSource = new EventSource(streamUrl.toString());
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("open", () => {
      setConnected(true);
      setLastError(null);
      resolvePendingConnectionsRef.current();
    });

    eventSource.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      const message = parseServerMessage(event.data);
      if (!message) {
        return;
      }

      switch (message.type) {
        case "connected": {
          setConnected(true);
          setLastError(null);
          resolvePendingConnectionsRef.current();
          requestSessionPageRef.current(0, SESSION_PAGE_SIZE);
          ensureSessionLoadedRef.current(activeSessionIdRef.current);
          break;
        }
        case "sessions_page": {
          setLoadingMoreSessions(false);
          setServerLoadedSessionCount((previous) =>
            Math.max(previous, message.offset + message.sessions.length),
          );
          setTotalSessionCount(message.total);
          setSessions((previous) => {
            let next = previous;
            for (const session of message.sessions) {
              next = upsertSessionInList(next, session);
            }
            return next;
          });
          setSessionCache((previous) => {
            const nextCache = new Map(previous);
            for (const session of message.sessions) {
              const cached = nextCache.get(session.id);
              nextCache.set(
                session.id,
                cached
                  ? {
                      ...cached,
                      session,
                    }
                  : createSummaryOnlyCacheEntry(session),
              );
            }
            return nextCache;
          });

          const currentActiveSessionId = activeSessionIdRef.current;
          if (currentActiveSessionId) {
            ensureSessionLoadedRef.current(currentActiveSessionId);
          }
          break;
        }
        case "session_summary_updated": {
          setSessionCache((previous) => {
            const nextCache = new Map(previous);
            const cached = nextCache.get(message.session.id);
            nextCache.set(
              message.session.id,
              cached
                ? {
                    ...cached,
                    session: message.session,
                  }
                : createSummaryOnlyCacheEntry(message.session),
            );
            return nextCache;
          });
          if (isScheduledSessionSummary(message.session)) {
            upsertJobRunForSession(message.session);
          } else {
            setSessions((previous) => upsertSessionInList(previous, message.session));
            setTotalSessionCount((previous) => {
              if (previous === null) {
                return Math.max(sessionsRef.current.length, 1);
              }
              const exists = sessionsRef.current.some(
                (session) => session.id === message.session.id,
              );
              return exists ? previous : previous + 1;
            });

            if (activeSessionIdRef.current === message.session.id) {
              ensureSessionLoadedRef.current(message.session.id);
            }
          }
          break;
        }
        case "session_created": {
          setLastError(null);
          upsertSessionSnapshotRef.current(message.session, message.transcript);

          if (!isScheduledSessionSummary(message.session)) {
            setTotalSessionCount((previous) => {
              if (previous === null) {
                return Math.max(sessionsRef.current.length, 1);
              }
              const exists = sessionsRef.current.some(
                (session) => session.id === message.session.id,
              );
              return exists ? previous : previous + 1;
            });
            setPendingDraft(false);
            activateSessionRef.current(message.session.id, { load: false });
          }
          break;
        }
        case "session_snapshot": {
          setLastError(null);
          upsertSessionSnapshotRef.current(message.session, message.transcript);
          break;
        }
        case "session_deleted": {
          removeSessionLocally(message.sessionId);
          removeRunLocally(message.sessionId);
          break;
        }
        case "jobs_snapshot": {
          setLoadingJobs(false);
          setJobsLoaded(true);
          setJobs(sortJobs(message.jobs));
          setJobRunsByJobId((previous) => {
            const validJobIds = new Set(message.jobs.map((job) => job.id));
            const nextEntries = Object.entries(previous).filter(([jobId]) =>
              validJobIds.has(jobId),
            );

            return nextEntries.length === Object.keys(previous).length
              ? previous
              : Object.fromEntries(nextEntries);
          });
          break;
        }
        case "job_runs_snapshot": {
          setLoadingJobRunsByJobId((previous) => ({
            ...previous,
            [message.jobId]: false,
          }));
          setJobRunsByJobId((previous) => ({
            ...previous,
            [message.jobId]: message.runs,
          }));
          break;
        }
        case "job_updated": {
          setJobsLoaded(true);
          setJobs((previous) => upsertJobInList(previous, message.job));
          break;
        }
        case "job_deleted": {
          setJobs((previous) => removeJobFromList(previous, message.jobId));
          setJobRunsByJobId((previous) => {
            if (!(message.jobId in previous)) {
              return previous;
            }

            const next = { ...previous };
            delete next[message.jobId];
            return next;
          });
          setLoadingJobRunsByJobId((previous) => {
            if (!(message.jobId in previous)) {
              return previous;
            }

            const next = { ...previous };
            delete next[message.jobId];
            return next;
          });
          break;
        }
        case "assistant_delta": {
          applyAssistantDelta(
            message.sessionId,
            message.messageId,
            message.delta,
            "body",
            message.contentIndex,
          );
          break;
        }
        case "assistant_thinking_delta": {
          applyAssistantDelta(
            message.sessionId,
            message.messageId,
            message.delta,
            "thinking",
            message.contentIndex,
          );
          break;
        }
        case "error": {
          setPendingDraft(false);
          setLoadingJobs(false);
          setLastError(message.message);
          break;
        }
        case "pong": {
          break;
        }
      }
    });

    eventSource.addEventListener("error", () => {
      setConnected(false);
      setLoadingJobs(false);
      setLastError((current) => current ?? STREAM_DISCONNECTED_MESSAGE);
    });

    return () => {
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
      eventSource.removeAllEventListeners();
      eventSource.close();
      setConnected(false);
    };
  }, [pairingReady, relayAuth?.token, streamRequested, transportConfig.streamUrl]);

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
        jobRunsByJobId,
        loadingJobRunsByJobId,
        activateSession,
        consumeLastSessionRestore,
        updateTransportSettings,
        requestSessionSnapshot,
        loadMoreSessions,
        refreshJobs,
        refreshJobRuns,
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

export function useChatClient() {
  const context = useContext(ChatClientContext);
  if (!context) {
    throw new Error("useChatClient must be used inside ChatClientProvider.");
  }

  return context;
}
