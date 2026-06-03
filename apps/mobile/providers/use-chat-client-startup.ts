// @ts-nocheck
import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_TRANSPORT_SETTINGS, normalizeStoredTransportSettings } from "@/lib/transport-config";
import { ACTIVE_SESSION_STORAGE_KEY, SERVER_URL_STORAGE_KEY, TRANSPORT_SETTINGS_STORAGE_KEY } from "./chat-client-utils";

export function useChatClientStartup(options: any) {
	const { activeSessionIdRef, activeSessionId, pendingDraftRef, pendingDraft, sessionsRef, sessions, sessionCacheRef, sessionCache, jobsRef, jobs, loadingJobsRef, loadingJobs, loadingProvidersRef, loadingProviders, loadingJobRunsByJobIdRef, loadingJobRunsByJobId, transportSettingsRef, transportSettings, setTransportSettings, setActiveSessionId, setShouldRestoreLastSession, setIsHydrated, isHydrated } = options;
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
    loadingProvidersRef.current = loadingProviders;
  }, [loadingProviders]);

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
}
