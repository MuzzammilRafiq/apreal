import { memo, useEffect, useRef } from "react";
import {
  FlatList,
  Platform,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Colors } from "@/constants/theme";
import type { TranscriptMessage } from "@/types/chat";

import { ChatMessageBubble } from "./chat-message-bubble";
import { ThemedText } from "../themed-text";

const AUTO_SCROLL_THRESHOLD = 80;

export type ChatTranscriptEmptyState = {
  title: string;
  body: string;
};

type ChatTranscriptProps = {
  messages: TranscriptMessage[];
  emptyState: ChatTranscriptEmptyState | null;
  palette: (typeof Colors)["light"];
  sessionKey: string;
};

function ChatTranscriptComponent({
  messages,
  emptyState,
  palette,
  sessionKey,
}: ChatTranscriptProps) {
  const listRef = useRef<FlatList<TranscriptMessage>>(null);
  const shouldAutoScrollRef = useRef(true);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    isNearBottomRef.current = true;
  }, [sessionKey]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [emptyState, messages]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);

    isNearBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
  }

  function handleContentSizeChange() {
    if (!shouldAutoScrollRef.current || !isNearBottomRef.current) {
      return;
    }

    shouldAutoScrollRef.current = false;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }

  return (
    <FlatList
      ref={listRef}
      data={emptyState ? [] : messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ChatMessageBubble message={item} />}
      style={styles.transcript}
      contentContainerStyle={[
        styles.transcriptContent,
        emptyState ? styles.transcriptContentEmpty : null,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={8}
      removeClippedSubviews={Platform.OS === "android"}
      scrollEventThrottle={16}
      onScroll={handleScroll}
      onContentSizeChange={handleContentSizeChange}
      ListEmptyComponent={
        emptyState ? (
          <View style={styles.emptyState}>
            <ThemedText type="title" style={styles.emptyTitle}>
              {emptyState.title}
            </ThemedText>
            <ThemedText
              style={[styles.emptyBody, { color: palette.mutedText }]}
            >
              {emptyState.body}
            </ThemedText>
          </View>
        ) : null
      }
    />
  );
}

export const ChatTranscript = memo(ChatTranscriptComponent);

const styles = StyleSheet.create({
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  transcriptContentEmpty: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 56,
  },
  emptyTitle: {
    fontSize: 30,
    lineHeight: 32,
  },
  emptyBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
  },
});
