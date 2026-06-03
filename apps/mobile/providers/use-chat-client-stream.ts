// @ts-nocheck
import { useEffect } from "react";
import EventSource from "react-native-sse";
import { SESSION_PAGE_SIZE, STREAM_DISCONNECTED_MESSAGE, createSummaryOnlyCacheEntry, isScheduledSessionSummary, parseServerMessage, removeJobFromList, sortJobs, upsertJobInList, upsertSessionInList } from "./chat-client-utils";

export function useChatClientStream(options: any) {
	const { relayAuth, pairingReady, setStreamRequested, streamRequested, setConnected, transportConfig, eventSourceRef, setLastError, resolvePendingConnectionsRef, requestSessionPageRef, ensureSessionLoadedRef, activeSessionIdRef, setLoadingMoreSessions, setServerLoadedSessionCount, setTotalSessionCount, setSessions, setSessionCache, upsertJobRunForSession, sessionsRef, setPendingDraft, activateSessionRef, upsertSessionSnapshotRef, removeSessionLocally, removeRunLocally, setLoadingJobs, setJobsLoaded, setJobs, setJobRunsByJobId, setLoadingProviders, setProvidersLoaded, setProviders, setLoadingJobRunsByJobId, applyAssistantDelta } = options;
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
        case "providers_snapshot": {
          setLoadingProviders(false);
          setProvidersLoaded(true);
          setProviders({
            providers: message.providers,
            defaultProvider: message.defaultProvider,
            defaultModel: message.defaultModel,
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
          setLoadingProviders(false);
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
}
