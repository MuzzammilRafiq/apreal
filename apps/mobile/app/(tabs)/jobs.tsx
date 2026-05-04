import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";
import type { ScheduledJobDetails } from "@/types/chat";

function formatRelativeNextRun(nextRunAt: number) {
  const diff = nextRunAt - Date.now();
  const absMs = Math.abs(diff);
  const minutes = Math.round(absMs / 60_000);

  if (absMs < 30_000) return "now";
  if (absMs < 60_000) return diff > 0 ? "in <1m" : "<1m ago";
  if (minutes < 60) return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

function getJobStatusCopy(job: ScheduledJobDetails) {
  if (!job.enabled) {
    return { label: "Paused", colorKey: "statusPending" as const };
  }

  if (job.lastError) {
    return { label: "Error", colorKey: "statusDisconnected" as const };
  }

  return { label: "Active", colorKey: "statusConnected" as const };
}

export default function JobsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    clearError,
    connected,
    connectionLabel,
    jobs,
    jobsLoaded,
    lastError,
    loadingJobs,
    pairingReady,
    pairingState,
    refreshJobs,
    serverUrl,
  } = useChatClient();
  const [jobError, setJobError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!pairingReady) {
        return;
      }

      void refreshJobs().catch(() => {
        // Provider stores the error for rendering.
      });
    }, [pairingReady, refreshJobs]),
  );

  async function handleRefresh() {
    setJobError(null);
    try {
      await refreshJobs();
    } catch (error) {
      setJobError(error instanceof Error ? error.message : String(error));
    }
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
          <View style={styles.headerCopy}>
            <ThemedText type="title" style={styles.title}>
              Cron jobs
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: palette.mutedText }]}> 
              Open a job to inspect each run and its output.
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh jobs"
            disabled={!pairingReady || loadingJobs}
            onPress={() => {
              void handleRefresh();
            }}
            style={({ pressed }) => [
              styles.headerButton,
              {
                backgroundColor: pressed
                  ? palette.cardPressed
                  : palette.cardBackground,
                borderColor: palette.border,
                opacity: !pairingReady || loadingJobs ? 0.55 : 1,
              },
            ]}
          >
            <Ionicons name="refresh-outline" size={18} color={palette.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: palette.cardBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.statusRow}>
              <View>
                <ThemedText type="defaultSemiBold">Relay transport</ThemedText>
                <ThemedText style={[styles.metaText, { color: palette.mutedText }]}> 
                  {connectionLabel}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor: connected
                      ? palette.toolCompletedBackground
                      : palette.toolFailedBackground,
                  },
                ]}
              >
                <ThemedText
                  style={{
                    color: connected
                      ? palette.statusConnected
                      : palette.statusDisconnected,
                    fontSize: 12,
                    lineHeight: 16,
                    fontWeight: "700",
                  }}
                >
                  {connected ? "Connected" : "Disconnected"}
                </ThemedText>
              </View>
            </View>

            <ThemedText style={[styles.copy, { color: palette.mutedText }]}> 
              {pairingReady
                ? `Paired to agent ${pairingState?.agentId ?? "unknown"}`
                : `Pairing code: ${pairingState?.pairingCode ?? "Issuing..."}`}
            </ThemedText>
            <ThemedText style={[styles.copy, { color: palette.mutedText }]}> 
              Relay URL: {serverUrl}
            </ThemedText>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/settings/server")}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: pressed
                    ? palette.cardPressed
                    : palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <Ionicons name="settings-outline" size={16} color={palette.text} />
              <ThemedText type="defaultSemiBold">Open pairing details</ThemedText>
            </Pressable>
          </View>

          {jobError || lastError ? (
            <View
              style={[
                styles.errorCard,
                {
                  backgroundColor: palette.dangerBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.errorRow}>
                <ThemedText style={[styles.errorText, { color: palette.dangerText }]}> 
                  {jobError ?? lastError}
                </ThemedText>
                <Pressable
                  onPress={() => {
                    setJobError(null);
                    clearError();
                  }}
                  style={styles.dismissButton}
                >
                  <Ionicons name="close" size={18} color={palette.dangerText} />
                </Pressable>
              </View>
            </View>
          ) : null}

          {!pairingReady ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">Waiting for pairing</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}> 
                Cron jobs stay unavailable until the relay marks this phone as paired.
              </ThemedText>
            </View>
          ) : null}

          {loadingJobs && !jobsLoaded ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">Loading jobs...</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}> 
                Fetching scheduled jobs through the relay.
              </ThemedText>
            </View>
          ) : null}

          {pairingReady && jobsLoaded && jobs.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">No scheduled jobs</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}> 
                The server does not have any cron jobs yet.
              </ThemedText>
            </View>
          ) : null}

          {jobs.length > 0 ? (
            <View style={styles.sectionHeader}>
              <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
                Scheduled jobs
              </ThemedText>
              <ThemedText style={[styles.sectionCaption, { color: palette.mutedText }]}> 
                Tap a job to inspect each run.
              </ThemedText>
            </View>
          ) : null}

          {jobs.map((job) => {
            const status = getJobStatusCopy(job);
            return (
              <View
                key={job.id}
                style={[
                  styles.jobCard,
                  {
                    backgroundColor: palette.cardBackground,
                    borderColor: palette.border,
                    shadowColor: "#000",
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/jobs/[jobId]",
                      params: { jobId: job.id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.jobCardPressable,
                    pressed ? { opacity: 0.82 } : null,
                  ]}
                >
                  <View style={styles.jobCopy}>
                    <View style={styles.jobTitleRow}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.jobTitle}
                        numberOfLines={1}
                      >
                        {job.name}
                      </ThemedText>
                      <View
                        style={[
                          styles.jobPill,
                          {
                            borderColor: palette.border,
                            backgroundColor: palette.cardPressed,
                          },
                        ]}
                      >
                        <ThemedText
                          style={{
                            color: palette[status.colorKey],
                            fontSize: 12,
                            lineHeight: 16,
                            fontWeight: "700",
                          }}
                        >
                          {status.label}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText
                      numberOfLines={2}
                      style={[styles.promptPreview, { color: palette.mutedText }]}
                    >
                      {job.prompt}
                    </ThemedText>

                    <View style={styles.jobMetaRow}>
                      <ThemedText style={[styles.jobMeta, { color: palette.mutedText }]}> 
                        {job.runCount} run{job.runCount === 1 ? "" : "s"}
                      </ThemedText>
                      <ThemedText style={[styles.jobMeta, { color: palette.mutedText }]}> 
                        Next {formatRelativeNextRun(job.nextRunAt)}
                      </ThemedText>
                    </View>

                    {job.lastError ? (
                      <ThemedText
                        numberOfLines={1}
                        style={[styles.jobError, { color: palette.dangerText }]}
                      >
                        Last error: {job.lastError}
                      </ThemedText>
                    ) : null}
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={palette.mutedText} />
                </Pressable>
              </View>
            );
          })}
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
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    gap: 14,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    fontSize: 13,
    lineHeight: 18,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dismissButton: {
    padding: 2,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  sectionCaption: {
    fontSize: 13,
    lineHeight: 18,
  },
  jobCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  jobCardPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  jobCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  jobTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  jobTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
  },
  jobPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  promptPreview: {
    fontSize: 14,
    lineHeight: 20,
  },
  jobMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  jobMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  jobError: {
    fontSize: 12,
    lineHeight: 16,
  },
});