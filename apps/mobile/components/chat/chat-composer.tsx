import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { SessionSummary } from "@/types/chat";

function formatContextCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return value.toString();
}

function formatCurrentContext(session: SessionSummary | null): string | null {
  if (!session) {
    return null;
  }

  const usage = session.contextUsage;
  if (!usage || usage.tokens === null) {
    return null;
  }

  return `${formatContextCount(usage.tokens)}/${formatContextCount(usage.contextWindow)}`;
}

type ChatComposerProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  connected: boolean;
  busy: boolean;
  canSend: boolean;
  activeSession: SessionSummary | null;
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
};

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onAbort,
  connected,
  busy,
  canSend,
  activeSession,
  onSubmitEditing,
}: ChatComposerProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const buttonDisabled = !connected || (!canSend && !busy);
  const currentContextLabel = formatCurrentContext(activeSession);

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: 4 },
      ]}
    >
      {currentContextLabel ? (
        <View style={styles.contextRow}>
          <Text
            numberOfLines={1}
            style={[styles.contextValue, { color: palette.mutedText }]}
          >
            {currentContextLabel}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.shell,
          {
            backgroundColor: palette.composerBackground,
            borderColor: palette.border,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          style={[styles.input, { color: palette.text }]}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          editable={connected && !busy}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Abort response" : "Send message"}
          disabled={buttonDisabled}
          onPress={busy ? onAbort : onSend}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: busy
                ? palette.dangerText
                : canSend
                  ? palette.userBubble
                  : palette.surface,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name={busy ? "stop" : "arrow-up"}
            size={18}
            color={busy || canSend ? palette.userBubbleText : palette.mutedText}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  contextRow: {
    alignItems: "flex-end",
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  contextValue: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: "right",
    paddingVertical: 0,
  },
  shell: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 17,
    maxHeight: 92,
    fontSize: 14,
    lineHeight: 17,
    textAlignVertical: "center",
    paddingTop: 0,
    paddingBottom: 0,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
