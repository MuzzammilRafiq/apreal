import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  createRelayProtocols,
  fetchRelayBootstrap,
  normalizeRelayPrincipalId,
  type RelayPairingStateMessage,
} from "@/lib/relay";
import {
  createWirePayload,
  DEFAULT_TRANSPORT_SETTINGS,
  getRelayTransportConfig,
  normalizeStoredTransportSettings,
  parseIncomingServerMessage,
  type StoredTransportSettings,
} from "@/lib/transport-config";
import type {
  ClientMessage,
  SessionCacheEntry,
  SessionSummary,
  TranscriptMessage,
  TranscriptMessageSegment,
} from "@/types/chat";

const ACTIVE_SESSION_STORAGE_KEY = "pi-mobile-active-session";
const TRANSPORT_SETTINGS_STORAGE_KEY = "pi-mobile-transport-settings";
const SERVER_URL_STORAGE_KEY = "pi-mobile-server-url";
const RELAY_CLIENT_ID_STORAGE_KEY = "pi-mobile-relay-client-id";
const RECONNECT_DELAY_MS = 1500;

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
  activeSessionId: string | null;
  pendingDraft: boolean;
  activeSession: SessionSummary | null;
  activeTranscript: TranscriptMessage[];
  lastError: string | null;
  activateSession: (
    sessionId: string | null,
    options?: ActivateSessionOptions,
  ) => void;
  updateTransportSettings: (settings: StoredTransportSettings) => void;
  requestSessionSnapshot: (sessionId: string | null) => void;
  sendPrompt: (prompt: string, sessionId?: string | null) => boolean;
  abortSession: (sessionId: string) => void;
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
  const [lastError, setLastError] = useState<string | null>(null);
  const [pairingState, setPairingState] =
    useState<RelayPairingStateMessage | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const pendingDraftRef = useRef(pendingDraft);
  const sessionsRef = useRef(sessions);
  const sessionCacheRef = useRef(sessionCache);
  const transportSettingsRef = useRef(transportSettings);
  const pairingStateRef = useRef(pairingState);
  const relayClientIdRef = useRef<string | null>(null);

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
    transportSettingsRef.current = transportSettings;
  }, [transportSettings]);

  useEffect(() => {
    pairingStateRef.current = pairingState;
  }, [pairingState]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [
          storedTransportSettings,
          storedLegacyServerUrl,
          storedActiveSessionId,
          storedRelayClientId,
        ] = await Promise.all([
          AsyncStorage.getItem(TRANSPORT_SETTINGS_STORAGE_KEY),
          AsyncStorage.getItem(SERVER_URL_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY),
          AsyncStorage.getItem(RELAY_CLIENT_ID_STORAGE_KEY),
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
                relayWebSocketUrl:
                  relayWebSocketUrl ?? storedLegacyServerUrl ?? legacyLocalServerUrl,
                relayBootstrapUrl,
              }),
            );
          } catch {
            setTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
          }
        } else if (storedLegacyServerUrl?.trim()) {
          setTransportSettings(
            normalizeStoredTransportSettings({
              relayWebSocketUrl: storedLegacyServerUrl.trim(),
            }),
          );
        }

        if (storedActiveSessionId?.trim()) {
          setActiveSessionId(storedActiveSessionId);
          activeSessionIdRef.current = storedActiveSessionId;
        }

        const normalizedRelayClientId = normalizeRelayPrincipalId(
          storedRelayClientId,
        );
        if (normalizedRelayClientId) {
          relayClientIdRef.current = normalizedRelayClientId;
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
      [SERVER_URL_STORAGE_KEY, transportSettingsRef.current.relayWebSocketUrl],
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

  function storeRelayClientId(clientId: string) {
    relayClientIdRef.current = clientId;
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(RELAY_CLIENT_ID_STORAGE_KEY, clientId);
  }

  function resetRuntimeState() {
    setConnected(false);
    setPendingDraft(false);
    setSessions([]);
    setSessionCache(new Map());
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setPairingState(null);
    setLastError(null);
  }

  function sendClientMessage(socket: WebSocket, message: ClientMessage) {
    socket.send(createWirePayload(message));
  }

  function requestSessionSnapshot(sessionId: string | null) {
    const socket = socketRef.current;
    if (!sessionId || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    sendClientMessage(socket, { type: "load_session", sessionId });
  }

  function activateSession(
    sessionId: string | null,
    options: ActivateSessionOptions = {},
  ) {
    const { load = true } = options;
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setPendingDraft(false);

    if (load && sessionId) {
      requestSessionSnapshot(sessionId);
    }
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
      });
      return nextCache;
    });
    setSessions((previous) => upsertSessionInList(previous, session));
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

      const transcript = cached.transcript.map((entry) => {
        if (entry.id !== messageId) {
          return entry;
        }

        if (field === "thinking") {
          const existingSegmentIndex = entry.segments.findIndex(
            (segment) =>
              segment.type === "thinking" &&
              segment.contentIndex === contentIndex,
          );
          const now = Date.now();
          let segments = entry.segments;

          if (existingSegmentIndex >= 0) {
            segments = [...entry.segments];
            const existingSegment = segments[existingSegmentIndex];
            if (existingSegment?.type === "thinking") {
              segments[existingSegmentIndex] = {
                ...existingSegment,
                content: `${existingSegment.content}${delta}`,
                updatedAt: now,
              };
            }
          } else {
            segments = insertSegmentInOrder(entry.segments, {
              id: createLocalId("thinking"),
              type: "thinking",
              content: delta,
              contentIndex,
              createdAt: now,
              updatedAt: now,
            });
          }

          return {
            ...entry,
            pending: true,
            thinking: `${entry.thinking}${delta}`,
            segments,
          };
        }

        const existingSegmentIndex = entry.segments.findIndex(
          (segment) =>
            segment.type === "text" && segment.contentIndex === contentIndex,
        );
        const now = Date.now();
        let segments = entry.segments;

        if (existingSegmentIndex >= 0) {
          segments = [...entry.segments];
          const existingSegment = segments[existingSegmentIndex];
          if (existingSegment?.type === "text") {
            segments[existingSegmentIndex] = {
              ...existingSegment,
              content: `${existingSegment.content}${delta}`,
              updatedAt: now,
            };
          }
        } else {
          segments = insertSegmentInOrder(entry.segments, {
            id: createLocalId("text"),
            type: "text",
            content: delta,
            contentIndex,
            createdAt: now,
            updatedAt: now,
          });
        }

        return {
          ...entry,
          pending: true,
          body: `${entry.body}${delta}`,
          segments,
        };
      });

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

  function clearError() {
    setLastError(null);
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
    const socket = socketRef.current;
    const activeSession = sessionId
      ? (sessionsRef.current.find((session) => session.id === sessionId) ??
        null)
      : null;

    if (
      !trimmedPrompt ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      pendingDraftRef.current ||
      Boolean(activeSession?.busy) ||
      pairingStateRef.current?.status !== "paired"
    ) {
      return false;
    }

    setPendingDraft(!sessionId);
    if (sessionId) {
      markSessionBusy(sessionId);
    }

    sendClientMessage(socket, {
      type: "prompt",
      prompt: trimmedPrompt,
      sessionId,
    });

    return true;
  }

  function abortSession(sessionId: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    sendClientMessage(socket, { type: "abort", sessionId });
  }

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let disposed = false;

    const scheduleReconnect = () => {
      if (!disposed) {
        reconnectTimerRef.current = setTimeout(() => {
          void connect();
        }, RECONNECT_DELAY_MS);
      }
    };

    const notifyDisconnect = () => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      sendClientMessage(socket, { type: "disconnect" });
    };

    const connect = async () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      try {
        const transportConfig = getRelayTransportConfig(transportSettingsRef.current);
        const clientId = relayClientIdRef.current ?? createLocalId("relay-client");
        const bootstrap = await fetchRelayBootstrap(
          transportConfig.bootstrapUrl,
          clientId,
        );

        if (disposed) {
          return;
        }

        storeRelayClientId(bootstrap.clientId);
        setPairingState(bootstrap.pairing);

        const socket = new WebSocket(
          bootstrap.websocketUrl,
          createRelayProtocols(bootstrap.token),
        );
        socketRef.current = socket;

        socket.onopen = () => {
          if (disposed) {
            socket.close();
            return;
          }

          setConnected(true);
          setLastError(null);
          sendClientMessage(socket, { type: "hello" });
        };

        socket.onmessage = (event) => {
          const message = parseIncomingServerMessage(event.data);
          if (!message) {
            setLastError("Received an invalid server message.");
            return;
          }

          switch (message.type) {
            case "connected": {
              const normalizedClientId = normalizeRelayPrincipalId(
                message.clientId,
              );
              if (normalizedClientId) {
                storeRelayClientId(normalizedClientId);
              }
              setLastError(null);
              break;
            }
            case "pairing_state": {
              const shouldSendHello =
                message.status === "paired" &&
                pairingStateRef.current?.status !== "paired";
              setPairingState(message);
              if (shouldSendHello && socket.readyState === WebSocket.OPEN) {
                sendClientMessage(socket, { type: "hello" });
              }
              break;
            }
            case "sessions_updated": {
              setSessions(message.sessions);
              setSessionCache((previous) => {
                const nextCache = new Map(previous);
                for (const session of message.sessions) {
                  const cached = nextCache.get(session.id);
                  nextCache.set(session.id, {
                    session,
                    transcript: cached?.transcript ?? [],
                  });
                }
                return nextCache;
              });

              const currentActiveSessionId = activeSessionIdRef.current;
              if (!currentActiveSessionId) {
                break;
              }

              const nextActiveSession =
                message.sessions.find(
                  (session) => session.id === currentActiveSessionId,
                ) ?? null;

              if (!nextActiveSession) {
                activateSession(null, { load: false });
                break;
              }

              const cached = sessionCacheRef.current.get(nextActiveSession.id);
              if (
                !cached ||
                cached.session.updatedAt < nextActiveSession.updatedAt
              ) {
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
              setLastError(message.message);
              break;
            }
            case "pong": {
              break;
            }
          }
        };

        socket.onerror = () => {
          setConnected(false);
        };

        socket.onclose = () => {
          if (socketRef.current === socket) {
            socketRef.current = null;
          }

          setConnected(false);
          setPendingDraft(false);
          setPairingState(null);
          scheduleReconnect();
        };
      } catch (error) {
        setConnected(false);
        setLastError(getErrorMessage(error));
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      notifyDisconnect();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    isHydrated,
    transportSettings.relayBootstrapUrl,
    transportSettings.relayWebSocketUrl,
  ]);

  const transportConfig = getRelayTransportConfig(transportSettings);
  const pairingReady = pairingState?.status === "paired";
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeTranscript = activeSessionId
    ? (sessionCache.get(activeSessionId)?.transcript ?? [])
    : [];

  return (
    <ChatClientContext.Provider
      value={{
        isHydrated,
        connected,
        transportSettings,
        connectionLabel: transportConfig.label,
        serverUrl: transportSettings.relayBootstrapUrl,
        pairingState,
        pairingReady,
        sessions,
        activeSessionId,
        pendingDraft,
        activeSession,
        activeTranscript,
        lastError,
        activateSession,
        updateTransportSettings,
        requestSessionSnapshot,
        sendPrompt,
        abortSession,
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
