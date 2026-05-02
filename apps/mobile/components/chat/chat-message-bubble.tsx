import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Markdown from "react-native-markdown-display";

import { ThemedText } from "@/components/themed-text";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type {
  TranscriptMessage,
  TranscriptMessageSegment,
  TranscriptToolCall,
} from "@/types/chat";

type ChatMessageBubbleProps = {
  message: TranscriptMessage;
};

const TOOL_DESCRIPTION_MAP: Record<string, string> = {
  bash: "Runs a shell command in the workspace.",
  edit: "Updates an existing file in the workspace.",
  find: "Finds files by name or path.",
  grep: "Searches workspace files for matching text.",
  ls: "Lists files and folders in a directory.",
  read: "Reads a file or a selected line range.",
  web_search: "Searches the public web and extracts page text.",
  write: "Creates a new file in the workspace.",
};

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const isUser = message.role === "user";
  const assistantSegments =
    message.role === "assistant" ? message.segments : [];
  const liveThinkingSegmentId = message.pending
    ? ([...assistantSegments]
        .reverse()
        .find((segment) => segment.type === "thinking")?.id ?? null)
    : null;
  const shouldShowPlaceholder =
    message.pending && !message.body && assistantSegments.length === 0;
  const shouldShowStandaloneBody =
    message.role !== "assistant" && (message.body || shouldShowPlaceholder);
  const shouldShowAssistantBodyFallback =
    message.role === "assistant" &&
    assistantSegments.length === 0 &&
    Boolean(message.body);

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {isUser ? (
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: palette.userBubble,
              borderColor: palette.userBubble,
            },
            styles.userBubble,
          ]}
        >
          <ThemedText
            style={[styles.userMessage, { color: palette.userBubbleText }]}
          >
            {message.body}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.assistantContent}>
          {shouldShowStandaloneBody ? (
            <SystemMessageCard message={message} palette={palette} />
          ) : null}

          {shouldShowPlaceholder ? (
            <AssistantMarkdownMessage
              content="Thinking..."
              pending={message.pending}
              palette={palette}
            />
          ) : null}

          {shouldShowAssistantBodyFallback ? (
            <AssistantMarkdownMessage
              content={message.body}
              pending={message.pending}
              palette={palette}
            />
          ) : null}

          {message.role === "assistant" && assistantSegments.length > 0 ? (
            <View style={styles.segmentList}>
              {assistantSegments.map((segment) => (
                <AssistantSegmentBlock
                  key={segment.id}
                  item={message}
                  segment={segment}
                  isLiveThinking={
                    segment.type === "thinking" &&
                    segment.id === liveThinkingSegmentId
                  }
                  palette={palette}
                />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function formatToolStatus(status: TranscriptToolCall["status"]) {
  switch (status) {
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    default:
      return "Completed";
  }
}

function formatToolDescription(name: string, summary: string) {
  const normalizedName = name.trim().toLowerCase();
  const mappedDescription = TOOL_DESCRIPTION_MAP[normalizedName];
  if (mappedDescription) {
    return mappedDescription;
  }

  const normalizedSummary = summary.replace(/\s+/g, " ").trim();
  if (!normalizedSummary) {
    return "Runs a tool action.";
  }

  return normalizedSummary.length > 96
    ? `${normalizedSummary.slice(0, 93)}...`
    : normalizedSummary;
}

function AssistantMarkdownMessage({
  content,
  pending,
  palette,
}: {
  content: string;
  pending: boolean;
  palette: (typeof Colors)["light"];
}) {
  return (
    <View
      style={[
        styles.assistantMarkdownShell,
        pending ? styles.pendingBody : null,
      ]}
    >
      <Markdown
        onLinkPress={(url) => {
          void Linking.openURL(url);
          return false;
        }}
        style={createMarkdownStyles(palette)}
      >
        {content}
      </Markdown>
    </View>
  );
}

function ToolCallCard({
  name,
  summary,
  status,
  palette,
}: {
  name: string;
  summary: string;
  status: TranscriptToolCall["status"];
  palette: (typeof Colors)["light"];
}) {
  const toneStyle =
    status === "running"
      ? {
          backgroundColor: palette.toolRunningBackground,
          color: palette.toolRunningText,
        }
      : status === "failed"
        ? {
            backgroundColor: palette.toolFailedBackground,
            color: palette.toolFailedText,
          }
        : {
            backgroundColor: palette.toolCompletedBackground,
            color: palette.toolCompletedText,
          };
  const description = formatToolDescription(name, summary);

  return (
    <View
      style={[
        styles.toolCard,
        {
          backgroundColor: palette.toolBackground,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.toolHeader}>
        <ThemedText
          type="defaultSemiBold"
          style={styles.toolName}
          numberOfLines={1}
        >
          {name}
        </ThemedText>
        <View
          style={[
            styles.toolStatusPill,
            { backgroundColor: toneStyle.backgroundColor },
          ]}
        >
          <ThemedText
            style={[styles.toolStatusText, { color: toneStyle.color }]}
          >
            {formatToolStatus(status)}
          </ThemedText>
        </View>
      </View>
      <ThemedText
        style={[styles.toolDescription, { color: palette.mutedText }]}
        numberOfLines={2}
      >
        {description}
      </ThemedText>
    </View>
  );
}

function ThinkingCard({
  content,
  isLiveThinking,
  palette,
}: {
  content: string;
  isLiveThinking: boolean;
  palette: (typeof Colors)["light"];
}) {
  const [isOpen, setIsOpen] = useState(isLiveThinking);

  useEffect(() => {
    if (isLiveThinking) {
      setIsOpen(true);
    }
  }, [isLiveThinking]);

  return (
    <View
      style={[
        styles.thinkingShell,
        {
          backgroundColor: palette.thinkingBackground,
          borderColor: palette.thinkingBorder,
        },
      ]}
    >
      <Pressable
        style={styles.thinkingHeader}
        onPress={() => setIsOpen((value) => !value)}
      >
        <IconSymbol
          name="chevron.right"
          size={18}
          color={palette.icon}
          style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}
        />
        <ThemedText
          style={[styles.thinkingLabel, { color: palette.mutedText }]}
        >
          {isLiveThinking ? "Thinking trace (live)" : "Thinking trace"}
        </ThemedText>
      </Pressable>

      {isOpen ? (
        <ThemedText style={[styles.thinkingBody, { color: palette.mutedText }]}>
          {content}
        </ThemedText>
      ) : null}
    </View>
  );
}

function AssistantSegmentBlock({
  item,
  segment,
  isLiveThinking,
  palette,
}: {
  item: TranscriptMessage;
  segment: TranscriptMessageSegment;
  isLiveThinking: boolean;
  palette: (typeof Colors)["light"];
}) {
  if (segment.type === "text") {
    return (
      <AssistantMarkdownMessage
        content={segment.content}
        pending={item.pending}
        palette={palette}
      />
    );
  }

  if (segment.type === "tool_call") {
    return (
      <ToolCallCard
        name={segment.name}
        summary={segment.summary}
        status={segment.status}
        palette={palette}
      />
    );
  }

  return (
    <ThinkingCard
      content={segment.content}
      isLiveThinking={isLiveThinking}
      palette={palette}
    />
  );
}

function SystemMessageCard({
  message,
  palette,
}: {
  message: TranscriptMessage;
  palette: (typeof Colors)["light"];
}) {
  const isError = message.role === "error";

  return (
    <View
      style={[
        styles.systemCard,
        {
          backgroundColor: isError
            ? palette.dangerBackground
            : palette.cardBackground,
          borderColor: isError ? palette.dangerText : palette.border,
        },
      ]}
    >
      <ThemedText
        style={{ color: isError ? palette.dangerText : palette.text }}
      >
        {message.body}
      </ThemedText>
    </View>
  );
}

function createMarkdownStyles(palette: (typeof Colors)["light"]) {
  return {
    body: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 0,
      marginBottom: 0,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
    },
    heading1: {
      color: palette.text,
      fontSize: 19,
      lineHeight: 24,
      fontWeight: "700" as const,
      marginTop: 0,
      marginBottom: 10,
    },
    heading2: {
      color: palette.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "700" as const,
      marginTop: 0,
      marginBottom: 10,
    },
    heading3: {
      color: palette.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700" as const,
      marginTop: 0,
      marginBottom: 10,
    },
    bullet_list: {
      marginTop: 0,
      marginBottom: 10,
    },
    ordered_list: {
      marginTop: 0,
      marginBottom: 10,
    },
    list_item: {
      color: palette.text,
      marginBottom: 6,
    },
    bullet_list_icon: {
      color: palette.tint,
    },
    ordered_list_icon: {
      color: palette.tint,
    },
    strong: {
      color: palette.text,
      fontWeight: "700" as const,
    },
    em: {
      color: palette.text,
      fontStyle: "italic" as const,
    },
    blockquote: {
      color: palette.mutedText,
      borderLeftWidth: 3,
      borderLeftColor: palette.border,
      paddingLeft: 12,
      marginLeft: 0,
      marginBottom: 10,
    },
    code_inline: {
      color: palette.text,
      backgroundColor: palette.codeBackground,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      fontFamily: Fonts.mono,
    },
    code_block: {
      color: palette.text,
      backgroundColor: palette.codeBackground,
      borderRadius: 4,
      padding: 8,
      fontFamily: Fonts.mono,
    },
    fence: {
      color: palette.text,
      backgroundColor: palette.codeBackground,
      borderRadius: 4,
      padding: 8,
      fontFamily: Fonts.mono,
      marginBottom: 8,
    },
    link: {
      color: palette.tint,
      textDecorationLine: "underline" as const,
    },
    hr: {
      backgroundColor: palette.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 12,
    },
  };
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  assistantContent: {
    maxWidth: "100%",
    width: "100%",
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  assistantBubble: {
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  userMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  assistantMarkdownShell: {
    width: "100%",
  },
  pendingBody: {
    opacity: 0.7,
  },
  segmentList: {
    width: "100%",
    gap: 4,
  },
  toolCard: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  toolName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  toolStatusPill: {
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  toolStatusText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  toolDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  thinkingShell: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  thinkingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  thinkingLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  thinkingBody: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 14,
  },
  systemCard: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
  },
});
