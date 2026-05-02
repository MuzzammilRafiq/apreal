import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

function formatRelativeTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function SessionsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    activeSessionId,
    activateSession,
    canLoadMoreSessions,
    clearError,
    connectionLabel,
    consumeLastSessionRestore,
    connected,
    isHydrated,
    lastError,
    loadMoreSessions,
    loadingMoreSessions,
    pendingDraft,
    pairingReady,
    pairingState,
    sessions,
    shouldRestoreLastSession,
    totalSessionCount,
  } = useChatClient();

  useEffect(() => {
    if (
      !shouldRestoreLastSession ||
      !isHydrated ||
      pendingDraft ||
      !activeSessionId
    ) {
      return;
    }

    const activeSession = sessions.find(
      (session) => session.id === activeSessionId,
    );
    if (!activeSession) {
      return;
    }

    consumeLastSessionRestore();
    router.replace(`/chat/${activeSession.id}`);
  }, [
    activeSessionId,
    consumeLastSessionRestore,
    isHydrated,
    pendingDraft,
    router,
    sessions,
    shouldRestoreLastSession,
  ]);

  if (!isHydrated) {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <View style={styles.centeredState}>
          <ThemedText type="subtitle">Loading sessions...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
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
            <View style={styles.titleRow}>
              <ThemedText type="title" style={styles.title}>
                Apreal
            </ThemedText>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: connected
                    ? palette.statusConnected
                    : palette.statusDisconnected,
                },
              ]}
            />
          </View>
            <ThemedText style={[styles.subtitle, { color: palette.mutedText }]}>
              {connectionLabel}
            </ThemedText>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start new chat"
              disabled={!pairingReady}
              onPress={() => {
                activateSession(null, { load: false });
                router.push("/chat/draft");
              }}
              style={({ pressed }) => [
                styles.headerActionButton,
                {
                  backgroundColor: pairingReady
                    ? pressed
                      ? palette.cardPressed
                      : palette.userBubble
                    : palette.cardBackground,
                  borderColor: pairingReady ? palette.userBubble : palette.border,
                  opacity: pairingReady ? (pressed ? 0.9 : 1) : 0.5,
                },
              ]}
            >
              <Ionicons
                name="add"
                size={18}
                color={pairingReady ? palette.userBubbleText : palette.mutedText}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Server settings"
              onPress={() => router.push("/settings/server")}
              style={({ pressed }) => [
                styles.headerActionButton,
                {
                  backgroundColor: pressed
                    ? palette.cardPressed
                    : palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <Ionicons name="settings-outline" size={18} color={palette.text} />
            </Pressable>
          </View>
        </View>

      <View style={styles.content}>
        {!pairingReady ? (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: palette.cardBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <ThemedText type="defaultSemiBold">Relay pairing</ThemedText>
            <ThemedText style={[styles.pairingCode, { color: palette.text }]}>
              {pairingState?.pairingCode ?? "Issuing..."}
            </ThemedText>
            <ThemedText style={[styles.statusHint, { color: palette.mutedText }]}>
              Paste this code into the agent server. Sending stays disabled until
              the relay reports this phone as paired.
            </ThemedText>
          </View>
        ) : null}

        {lastError ? (
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
              <ThemedText
                style={[styles.errorText, { color: palette.dangerText }]}
              >
                {lastError}
              </ThemedText>
              <Pressable onPress={clearError} style={styles.dismissButton}>
                <Ionicons name="close" size={18} color={palette.dangerText} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <ThemedText type="defaultSemiBold">Sessions</ThemedText>
          <ThemedText style={{ color: palette.mutedText }}>
            {totalSessionCount === null
              ? sessions.length
              : `${sessions.length}/${totalSessionCount}`}
          </ThemedText>
        </View>

        <ScrollView
          style={styles.sessionList}
          contentContainerStyle={styles.sessionListContent}
          showsVerticalScrollIndicator={false}
        >
          {sessions.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: palette.cardBackground,
                  borderColor: palette.border,
                },
              ]}
            >
              <ThemedText type="defaultSemiBold">
                No saved sessions yet
              </ThemedText>
              <ThemedText
                style={[styles.emptyBody, { color: palette.mutedText }]}
              >
                Start a new chat and your first prompt will create a reusable
                session here.
              </ThemedText>
            </View>
          ) : (
            <>
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;

                return (
                  <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    onPress={() => {
                      activateSession(session.id);
                      router.push(`/chat/${session.id}`);
                    }}
                    style={({ pressed }) => [
                      styles.sessionCard,
                      {
                        backgroundColor:
                          isActive || pressed
                            ? palette.cardPressed
                            : palette.cardBackground,
                        borderColor: isActive ? palette.tint : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.sessionRow}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.sessionTitle}
                        numberOfLines={1}
                      >
                        {session.title}
                      </ThemedText>
                      <ThemedText
                        style={[styles.sessionMeta, { color: palette.mutedText }]}
                      >
                        {session.busy
                          ? "Running"
                          : formatRelativeTime(session.updatedAt)}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}

              {canLoadMoreSessions ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Load more sessions"
                  disabled={loadingMoreSessions}
                  onPress={loadMoreSessions}
                  style={({ pressed }) => [
                    styles.loadMoreButton,
                    {
                      backgroundColor: pressed
                        ? palette.cardPressed
                        : palette.cardBackground,
                      borderColor: palette.border,
                      opacity: loadingMoreSessions ? 0.65 : 1,
                    },
                  ]}
                >
                  <ThemedText type="defaultSemiBold">
                    {loadingMoreSessions ? "Loading..." : "Load more"}
                  </ThemedText>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 30,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 4,
    marginTop: 4,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  headerActionButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 14,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 16,
    gap: 8,
  },
  statusHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  pairingCode: {
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 4,
    fontWeight: "700",
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 4,
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  sessionList: {
    flex: 1,
  },
  sessionListContent: {
    paddingBottom: 16,
    gap: 12,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 18,
    gap: 8,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  sessionCard: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 0,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sessionTitle: {
    flex: 1,
  },
  sessionMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  loadMoreButton: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
