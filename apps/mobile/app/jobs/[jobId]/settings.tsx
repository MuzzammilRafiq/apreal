import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

function formatTimestamp(timestamp: number | null) {
  if (timestamp === null) {
    return "Never";
  }

  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

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

function formatInterval(intervalMs: number) {
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

export default function JobSettingsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string | string[] }>();
  const resolvedJobId = Array.isArray(jobId) ? jobId[0] : jobId;
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    deleteScheduledJob,
    jobs,
    jobsLoaded,
    pairingReady,
    refreshJobs,
    updateScheduledJob,
  } = useChatClient();
  const job = jobs.find((entry) => entry.id === resolvedJobId) ?? null;
  const [intervalDraft, setIntervalDraft] = useState("");
  const [screenError, setScreenError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    if (!resolvedJobId || !pairingReady || job || jobsLoaded) {
      return;
    }

    void refreshJobs().catch(() => {
      // Provider already stores request errors.
    });
  }, [job, jobsLoaded, pairingReady, refreshJobs, resolvedJobId]);

  useEffect(() => {
    if (!job) {
      setIntervalDraft("");
      return;
    }

    setIntervalDraft(String(Math.max(5, Math.round(job.intervalMs / 60_000))));
  }, [job]);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  }

  async function handleSaveInterval() {
    if (!job) {
      return;
    }

    const intervalMinutes = Number(intervalDraft);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) {
      setScreenError("Intervals must be at least 5 minutes.");
      return;
    }

    setIsMutating(true);
    setScreenError(null);
    try {
      await updateScheduledJob(job.id, { intervalMinutes });
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleToggleJob() {
    if (!job) {
      return;
    }

    setIsMutating(true);
    setScreenError(null);
    try {
      await updateScheduledJob(job.id, { enabled: !job.enabled });
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }

  function handleDeleteJob() {
    if (!job) {
      return;
    }

    Alert.alert(
      "Delete scheduled job",
      `Delete \"${job.name}\"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setIsMutating(true);
            setScreenError(null);
            void deleteScheduledJob(job.id)
              .then(() => {
                if (router.canGoBack()) {
                  router.back();
                }
              })
              .catch((error) => {
                setScreenError(error instanceof Error ? error.message : String(error));
              })
              .finally(() => {
                setIsMutating(false);
              });
          },
        },
      ],
    );
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
              Job settings
            </ThemedText>
            <ThemedText style={[styles.headerSubtitle, { color: palette.mutedText }]} numberOfLines={1}>
              {job?.name ?? "Loading job..."}
            </ThemedText>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {!job && jobsLoaded ? (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">Job not found</ThemedText>
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                This cron job may have been deleted.
              </ThemedText>
            </View>
          ) : null}

          {screenError ? (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: palette.dangerBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText style={[styles.copy, { color: palette.dangerText }]}>
                {screenError}
              </ThemedText>
            </View>
          ) : null}

          {job ? (
            <>
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: palette.cardBackground,
                    borderColor: palette.border,
                  },
                ]}
              >
                <ThemedText type="defaultSemiBold">Prompt</ThemedText>
                <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                  {job.prompt}
                </ThemedText>
              </View>

              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: palette.cardBackground,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={styles.metricsGrid}>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Current interval</ThemedText>
                    <ThemedText type="defaultSemiBold">{formatInterval(job.intervalMs)}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Next run</ThemedText>
                    <ThemedText type="defaultSemiBold">{formatRelativeNextRun(job.nextRunAt)}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Last run</ThemedText>
                    <ThemedText type="defaultSemiBold">{formatTimestamp(job.lastRunAt)}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Run count</ThemedText>
                    <ThemedText type="defaultSemiBold">{job.runCount}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Catchup</ThemedText>
                    <ThemedText type="defaultSemiBold">{job.maxCatchup}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <ThemedText style={[styles.metricLabel, { color: palette.mutedText }]}>Status</ThemedText>
                    <ThemedText type="defaultSemiBold">{job.enabled ? "Enabled" : "Paused"}</ThemedText>
                  </View>
                </View>

                {job.lastError ? (
                  <View
                    style={[
                      styles.inlineError,
                      {
                        backgroundColor: palette.dangerBackground,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.copy, { color: palette.dangerText }]}>
                      Last error: {job.lastError}
                    </ThemedText>
                  </View>
                ) : null}
              </View>

              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: palette.cardBackground,
                    borderColor: palette.border,
                  },
                ]}
              >
                <ThemedText type="defaultSemiBold">Interval</ThemedText>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={(value) => {
                    setIntervalDraft(value.replace(/[^0-9]/g, ""));
                  }}
                  placeholder="5"
                  placeholderTextColor={palette.mutedText}
                  style={[
                    styles.intervalInput,
                    {
                      backgroundColor: palette.background,
                      borderColor: palette.border,
                      color: palette.text,
                    },
                  ]}
                  value={intervalDraft}
                />

                <Pressable
                  accessibilityRole="button"
                  disabled={isMutating}
                  onPress={() => {
                    void handleSaveInterval();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: pressed
                        ? palette.cardPressed
                        : palette.userBubble,
                      borderColor: palette.userBubble,
                      opacity: isMutating ? 0.6 : 1,
                    },
                  ]}
                >
                  <ThemedText style={{ color: palette.userBubbleText, fontWeight: "700" }}>
                    Save interval
                  </ThemedText>
                </Pressable>
              </View>

              <View style={styles.actionsRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isMutating}
                  onPress={() => {
                    void handleToggleJob();
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor: pressed
                        ? palette.cardPressed
                        : palette.cardBackground,
                      borderColor: palette.border,
                      opacity: isMutating ? 0.6 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={job.enabled ? "pause-outline" : "play-outline"}
                    size={16}
                    color={palette.text}
                  />
                  <ThemedText type="defaultSemiBold">
                    {job.enabled ? "Pause" : "Resume"}
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={isMutating}
                  onPress={handleDeleteJob}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor: pressed
                        ? palette.dangerBackground
                        : palette.cardBackground,
                      borderColor: palette.border,
                      opacity: isMutating ? 0.6 : 1,
                    },
                  ]}
                >
                  <Ionicons name="trash-outline" size={16} color={palette.dangerText} />
                  <ThemedText style={{ color: palette.dangerText, fontWeight: "700" }}>
                    Delete
                  </ThemedText>
                </Pressable>
              </View>
            </>
          ) : null}
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
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricItem: {
    minWidth: "47%",
    gap: 2,
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  inlineError: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  intervalInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
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
    flex: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});