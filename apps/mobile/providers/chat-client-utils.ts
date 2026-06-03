import { createContext } from "react";
import type { ProvidersResponse, ScheduledJobDetails, ScheduledJobUpdateRequest } from "@apreal/shared";
import type { RelayPairingStateMessage, StoredRelayClientAuth } from "@/lib/relay-auth";
import type { StoredTransportSettings } from "@/lib/transport-config";
import type { JobRunSummary, SessionCacheEntry, SessionSummary, ServerMessage, TranscriptMessage, TranscriptMessageSegment } from "@/types/chat";

export const ACTIVE_SESSION_STORAGE_KEY = "pi-mobile-active-session";
export const TRANSPORT_SETTINGS_STORAGE_KEY = "pi-mobile-transport-settings";
export const SERVER_URL_STORAGE_KEY = "pi-mobile-server-url";
export const SESSION_PAGE_SIZE = 50;
export const STREAM_DISCONNECTED_MESSAGE =
  "Disconnected from the server stream. Reconnecting...";
export const STREAM_REQUIRED_MESSAGE = "Client event stream is not connected.";
export const AUTH_REFRESH_INTERVAL_MS = 3_000;
export const RELAY_HEARTBEAT_INTERVAL_MS = 500;

export type ActivateSessionOptions = {
  load?: boolean;
};

export type ChatClientContextValue = {
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
  providers: ProvidersResponse | null;
  providersLoaded: boolean;
  loadingProviders: boolean;
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
  refreshProviders: () => Promise<void>;
  refreshJobRuns: (jobId: string) => Promise<void>;
  updateDefaultModel: (provider: string, modelId: string) => Promise<void>;
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

export const ChatClientContext = createContext<ChatClientContextValue | null>(null);

export function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
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

export function upsertSessionInList(
  sessions: SessionSummary[],
  session: SessionSummary,
) {
  const nextSessions = sessions.filter((entry) => entry.id !== session.id);
  nextSessions.push(session);
  nextSessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return nextSessions;
}

export function upsertRunInList(runs: JobRunSummary[], run: JobRunSummary) {
  const nextRuns = runs.filter((entry) => entry.id !== run.id);
  nextRuns.push(run);
  nextRuns.sort((left, right) => right.updatedAt - left.updatedAt);
  return nextRuns;
}

export function createSummaryOnlyCacheEntry(session: SessionSummary): SessionCacheEntry {
  return {
    session,
    transcript: [],
    transcriptLoaded: false,
  };
}

export function sortJobs(jobs: ScheduledJobDetails[]): ScheduledJobDetails[] {
  return [...jobs].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return Number(right.enabled) - Number(left.enabled);
    }

    return left.nextRunAt - right.nextRunAt || left.name.localeCompare(right.name);
  });
}

export function upsertJobInList(
  jobs: ScheduledJobDetails[],
  job: ScheduledJobDetails,
): ScheduledJobDetails[] {
  return sortJobs([...jobs.filter((entry) => entry.id !== job.id), job]);
}

export function removeJobFromList(
  jobs: ScheduledJobDetails[],
  jobId: string,
): ScheduledJobDetails[] {
  return jobs.filter((entry) => entry.id !== jobId);
}

export function removeSessionFromList(
  sessions: SessionSummary[],
  sessionId: string,
): SessionSummary[] {
  return sessions.filter((entry) => entry.id !== sessionId);
}

export function getSegmentSortValue(segment: TranscriptMessageSegment) {
  return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

export function insertSegmentInOrder(
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

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to connect right now.";
}

export function parseScheduledJobNameFromTitle(title: string): string | null {
  const match = /^\[Scheduled: ([^\]]+)\]/.exec(title);
  return match?.[1] ?? null;
}

export function isScheduledSessionSummary(session: { title: string }): boolean {
  return parseScheduledJobNameFromTitle(session.title) !== null;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function appendAssistantDeltaToMessage(
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

export function buildPairingState(
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
