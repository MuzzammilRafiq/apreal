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
  placeholder: string;
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
  placeholder,
  onSubmitEditing,
}: ChatComposerProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const buttonDisabled = !connected || (!canSend && !busy);

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: 10 },
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
          placeholder={placeholder}
          placeholderTextColor={palette.mutedText}
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
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  shell: {
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 108,
    fontSize: 14,
    lineHeight: 18,
    textAlignVertical: "top",
    paddingTop: 7,
    paddingBottom: 7,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
