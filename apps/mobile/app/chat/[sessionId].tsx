import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    View,
    type NativeSyntheticEvent,
    type TextInputSubmitEditingEventData,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatTranscript } from "@/components/chat/chat-transcript";
import { ThemedText } from "@/components/themed-text";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

function formatSessionState(
  isDraft: boolean,
  pendingDraft: boolean,
  busy: boolean,
) {
  if (isDraft) {
    return pendingDraft ? "Starting" : "Draft";
  }

  return busy ? "Running" : "Saved";
}

export default function ChatDetailScreen() {
  const { sessionId } = useLocalSearchParams<{
    sessionId: string | string[];
  }>();
  const resolvedSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const isDraftRoute = resolvedSessionId === "draft";

  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    abortSession,
    activateSession,
    activeSession,
    activeSessionId,
    activeTranscript,
    activeTranscriptLoaded,
    clearError,
    connectionLabel,
    connected,
    deleteSession,
    isHydrated,
    lastError,
    pendingDraft,
    pairingReady,
    pairingState,
    sendPrompt,
    sessions,
  } = useChatClient();

  const syncedRouteRef = useRef<string | null>(null);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!resolvedSessionId || !isHydrated) {
      return;
    }

    if (syncedRouteRef.current === resolvedSessionId) {
      return;
    }

    if (resolvedSessionId === "draft") {
      activateSession(null, { load: false });
    } else {
      activateSession(resolvedSessionId);
    }

    syncedRouteRef.current = resolvedSessionId;
    setPrompt("");
  }, [activateSession, isHydrated, resolvedSessionId]);

  useEffect(() => {
    if (isDraftRoute && activeSessionId) {
      router.replace(`/chat/${activeSessionId}`);
    }
  }, [activeSessionId, isDraftRoute, router]);

  useEffect(() => {
    if (!resolvedSessionId || isDraftRoute || !isHydrated || pendingDraft) {
      return;
    }

    const stillExists = sessions.some(
      (session) => session.id === resolvedSessionId,
    );
    if (!stillExists && activeSessionId === null) {
      router.replace("/");
    }
  }, [
    activeSessionId,
    isDraftRoute,
    isHydrated,
    pendingDraft,
    resolvedSessionId,
    router,
    sessions,
  ]);

  if (!resolvedSessionId || !isHydrated) {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <View style={styles.centeredState}>
          <ThemedText type="subtitle">Loading chat...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const isBusy = pendingDraft || Boolean(activeSession?.busy);
  const canSend = connected && pairingReady && !isBusy && prompt.trim().length > 0;
  const sessionState = formatSessionState(
    isDraftRoute,
    pendingDraft,
    Boolean(activeSession?.busy),
  );
  const title = isDraftRoute
    ? "New chat"
    : (activeSession?.title ?? "Loading session");
  const emptyState = isDraftRoute
    ? {
        title: pendingDraft ? "Creating session..." : "Ready when you are",
        body: pendingDraft
          ? "The server is opening a shared session from your first prompt."
          : "Start with a coding task, file request, or bug report. Your first prompt creates a reusable session.",
      }
    : !activeTranscriptLoaded
      ? {
          title: "Loading session...",
          body: `Fetching the latest transcript from the ${connectionLabel}.`,
        }
      : activeTranscript.length === 0
        ? {
            title: "No messages yet",
            body: "This session is saved, but there is no transcript to show yet.",
          }
      : null;

  function handleSend() {
    const didSend = sendPrompt(prompt, isDraftRoute ? null : resolvedSessionId);
    if (didSend) {
      setPrompt("");
      clearError();
    }
  }

  function handleAbort() {
    if (!activeSession?.id) {
      return;
    }

    abortSession(activeSession.id);
  }

  function handleSubmitEditing(
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>,
  ) {
    if (Platform.OS === "web" && event.nativeEvent.text.includes("\n")) {
      return;
    }

    handleSend();
  }

  function handleBackNavigation() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    activateSession(null, { load: false });
    router.replace("/");
  }

  function handleDeleteChat() {
    if (!activeSession?.id) {
      return;
    }

    Alert.alert(
      "Delete Chat",
      `Delete \"${activeSession.title}\" from this phone and the server if it still exists there?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteSession(activeSession.id);
            router.replace("/");
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
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={handleBackNavigation}
            style={styles.navButton}
          >
            <Ionicons name="chevron-back" size={20} color={palette.text} />
          </Pressable>

          <View style={styles.headerCopy}>
            <ThemedText
              type="defaultSemiBold"
              numberOfLines={1}
              style={styles.headerTitle}
            >
              {title}
            </ThemedText>
            <ThemedText
              style={[styles.headerSubtitle, { color: palette.mutedText }]}
            >
              {connected ? "Connected" : "Disconnected"} · {sessionState}
            </ThemedText>
          </View>

          <View style={styles.headerActions}>
            {!isDraftRoute && activeSession?.id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete chat"
                onPress={handleDeleteChat}
                style={styles.navButton}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={palette.dangerText}
                />
              </Pressable>
            ) : null}
          </View>
        </View>

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

        {!pairingReady ? (
          <View
            style={[
              styles.pairingCard,
              {
                backgroundColor: palette.cardBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <ThemedText type="defaultSemiBold">Waiting for relay pairing</ThemedText>
            <ThemedText style={[styles.pairingCode, { color: palette.text }]}> 
              {pairingState?.pairingCode ?? "Issuing..."}
            </ThemedText>
            <ThemedText style={[styles.pairingCopy, { color: palette.mutedText }]}> 
              Paste this code into the agent server. The composer unlocks as soon
              as the relay marks this client as paired.
            </ThemedText>
          </View>
        ) : null}

        <ChatTranscript
          messages={activeTranscript}
          emptyState={emptyState}
          palette={palette}
          sessionKey={resolvedSessionId}
        />

        <ChatComposer
          value={prompt}
          onChangeText={setPrompt}
          onSend={handleSend}
          onAbort={handleAbort}
          onSubmitEditing={handleSubmitEditing}
          busy={isBusy}
          canSend={canSend}
          connected={connected}
          activeSession={activeSession}
        />
      </KeyboardAvoidingView>
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
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pairingCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  pairingCode: {
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: 4,
    fontWeight: "700",
  },
  pairingCopy: {
    fontSize: 13,
    lineHeight: 18,
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
});
