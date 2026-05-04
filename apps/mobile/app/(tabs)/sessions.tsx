import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Radii } from "@/constants/theme";
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
  const [headerHeight, setHeaderHeight] = useState(52);
  const {
    activeSessionId,
    activateSession,
    canLoadMoreSessions,
    clearError,
    consumeLastSessionRestore,
    connected,
    deleteSession,
    isHydrated,
    lastError,
    loadMoreSessions,
    loadingMoreSessions,
    pendingDraft,
    pairingReady,
    pairingState,
    sessions,
    shouldRestoreLastSession,
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
      <View style={styles.screen}>
        <ScrollView
          style={styles.sessionList}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: headerHeight },
          ]}
          showsVerticalScrollIndicator={false}
        >
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
            <View style={styles.sessionListContent}>
              <View style={styles.sectionHeader}>
                <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
                  Recent sessions
                </ThemedText>
                <ThemedText
                  style={[styles.sectionCaption, { color: palette.mutedText }]}
                >
                  Tap a card to continue
                </ThemedText>
              </View>

              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isScheduledSession = session.title.startsWith("[Scheduled:");

                function handleDeleteChatSession() {
                  Alert.alert(
                    "Delete Chat Session",
                    `Delete \"${session.title}\" from this phone and the server if it still exists there?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          void deleteSession(session.id);
                        },
                      },
                    ],
                  );
                }

                return (
                  <View
                    key={session.id}
                    style={[
                      styles.sessionCard,
                      {
                        backgroundColor: isActive
                          ? palette.cardPressed
                          : palette.cardBackground,
                        borderColor: palette.border,
                        shadowColor: "#000",
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        activateSession(session.id);
                        router.push(`/chat/${session.id}`);
                      }}
                      style={({ pressed }) => [
                        styles.sessionRow,
                        pressed ? { opacity: 0.8 } : null,
                      ]}
                    >
                      <View style={styles.sessionCopy}>
                        <View style={styles.sessionTitleRow}>
                          {isScheduledSession ? (
                            <View
                              style={[
                                styles.scheduledBadge,
                                {
                                  borderColor: palette.border,
                                  backgroundColor: palette.cardPressed,
                                },
                              ]}
                            >
                              <Ionicons
                                name="time-outline"
                                size={12}
                                color={palette.mutedText}
                              />
                            </View>
                          ) : null}
                          <ThemedText
                            type="defaultSemiBold"
                            style={styles.sessionTitle}
                            numberOfLines={1}
                          >
                            {session.title}
                          </ThemedText>
                        </View>
                        <View style={styles.sessionMetaRow}>
                          <ThemedText
                            style={[
                              styles.sessionMeta,
                              { color: palette.mutedText },
                            ]}
                          >
                            {session.messageCount > 0
                              ? `${session.messageCount} msgs`
                              : "No messages yet"}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.sessionMeta,
                              { color: palette.mutedText },
                            ]}
                          >
                            {formatRelativeTime(session.updatedAt)}
                          </ThemedText>
                        </View>
                      </View>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete chat session ${session.title}`}
                        hitSlop={8}
                        onPress={handleDeleteChatSession}
                        style={({ pressed }) => [
                          styles.deleteButton,
                          pressed
                            ? { backgroundColor: palette.dangerBackground }
                            : null,
                        ]}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={palette.dangerText}
                        />
                      </Pressable>
                    </Pressable>
                  </View>
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
            </View>
          )}
        </ScrollView>

        <View
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            setHeaderHeight((currentHeight) =>
              currentHeight === nextHeight ? currentHeight : nextHeight,
            );
          }}
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
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
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
    fontSize: 20,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 5,
  },
  headerActionButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
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
    borderRadius: Radii.surface,
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
  sessionList: {
    flex: 1,
  },
  sessionListContent: {
    gap: 10,
  },
  sectionHeader: {
    gap: 2,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  sectionCaption: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    padding: 18,
    gap: 8,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  sessionCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  sessionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scheduledBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
  },
  sessionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sessionMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  loadMoreButton: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});