import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type ChatComposerProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  connected: boolean;
  busy: boolean;
  canSend: boolean;
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
  onSubmitEditing,
}: ChatComposerProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const buttonDisabled = !connected || (!canSend && !busy);

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: 4 },
      ]}
    >
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
  shell: {
    borderWidth: 1,
    borderRadius: 4,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 34,
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
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
