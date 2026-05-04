import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string | string[] }>();
  const resolvedJobId = Array.isArray(jobId) ? jobId[0] : jobId;
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    getSessionCacheEntry,
    jobRunsByJobId,
    jobs,
    jobsLoaded,
    loadingJobRunsByJobId,
    pairingReady,
    refreshJobRuns,
    refreshJobs,
    requestSessionSnapshot,
  } = useChatClient();

  const job = jobs.find((entry) => entry.id === resolvedJobId) ?? null;
  const runs = useMemo(
    () => (resolvedJobId ? jobRunsByJobId[resolvedJobId] ?? [] : []),
    [jobRunsByJobId, resolvedJobId],
  );
  const loadingRuns = resolvedJobId
    ? Boolean(loadingJobRunsByJobId[resolvedJobId])
    : false;

  useEffect(() => {
    if (!resolvedJobId || !pairingReady || job || jobsLoaded) {
      return;
    }

    void refreshJobs().catch(() => {
      // Provider already holds request errors.
    });
  }, [job, jobsLoaded, pairingReady, refreshJobs, resolvedJobId]);

  useFocusEffect(
    useCallback(() => {
      if (!resolvedJobId || !pairingReady) {
        return;
      }

      void refreshJobRuns(resolvedJobId).catch(() => {
        // Provider already holds request errors.
      });
    }, [pairingReady, refreshJobRuns, resolvedJobId]),
  );

  useEffect(() => {
    for (const run of runs) {
      const cached = getSessionCacheEntry(run.id);
      if (!cached?.transcriptLoaded) {
        requestSessionSnapshot(run.id);
      }
    }
  }, [getSessionCacheEntry, requestSessionSnapshot, runs]);

  const notFound = resolvedJobId && jobsLoaded && !job;

  const runCards = useMemo(
    () =>
      runs.map((run) => {
        const cached = getSessionCacheEntry(run.id);
        const visibleMessages = cached?.transcriptLoaded
          ? cached.transcript.filter(
              (message) => message.role === "assistant" || message.role === "error",
            )
          : [];

        return {
          run,
          cached,
          visibleMessages,
        };
      }),
    [getSessionCacheEntry, runs],
  );

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  }

  if (!resolvedJobId) {
    return null;
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View style={styles.screen}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: palette.headerBackground,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={handleBack}
            style={styles.navButton}
          >
            <Ionicons name="chevron-back" size={20} color={palette.text} />
          </Pressable>

          <View style={styles.headerCopy}>
            <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
              {job?.name ?? "Cron job"}
            </ThemedText>
            <ThemedText style={[styles.headerSubtitle, { color: palette.mutedText }]} numberOfLines={2}>
              {job?.prompt ?? "Loading job details..."}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Job settings"
            disabled={!job}
            onPress={() => {
              if (!job) {
                return;
              }

              router.push({
                pathname: "/jobs/[jobId]/settings",
                params: { jobId: job.id },
              });
            }}
            style={({ pressed }) => [
              styles.navButton,
              {
                opacity: job ? (pressed ? 0.72 : 1) : 0.45,
              },
            ]}
          >
            <Ionicons name="settings-outline" size={18} color={palette.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {notFound ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">Job not found</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                This cron job may have been deleted or is no longer available.
              </ThemedText>
            </View>
          ) : null}

          {loadingRuns && runs.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">Loading runs...</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                Fetching output history for this cron job.
              </ThemedText>
            </View>
          ) : null}

          {!loadingRuns && runs.length === 0 && job ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">No output yet</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                This cron job has not produced any saved runs yet.
              </ThemedText>
            </View>
          ) : null}

          {runCards.map(({ run, cached, visibleMessages }) => (
            <View
              key={run.id}
              style={[
                styles.runCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.runHeader}>
                <View style={styles.runHeaderCopy}>
                  <ThemedText type="defaultSemiBold">
                    {formatTimestamp(run.updatedAt)}
                  </ThemedText>
                  <ThemedText style={[styles.metaText, { color: palette.mutedText }]}>
                    {run.busy ? "Running" : "Completed"}
                    {run.model ? ` · ${run.model}` : ""}
                    {run.messageCount > 0 ? ` · ${run.messageCount} msgs` : ""}
                  </ThemedText>
                </View>
              </View>

              {!cached?.transcriptLoaded ? (
                <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                  Loading output...
                </ThemedText>
              ) : visibleMessages.length === 0 ? (
                <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                  No assistant output was captured for this run.
                </ThemedText>
              ) : (
                <View style={styles.messagesList}>
                  {visibleMessages.map((message) => (
                    <ChatMessageBubble key={message.id} message={message} />
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
  },
  runCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  runHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 16,
  },
  messagesList: {
    gap: 10,
  },
});