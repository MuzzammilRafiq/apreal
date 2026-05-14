import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Markdown, themes, type Renderers } from "react-native-remark";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import { ThemedText } from "@/components/themed-text";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type {
  TranscriptMessage,
  TranscriptMessageSegment,
  TranscriptToolCall,
} from "@/types/chat";

type ChatMessageBubbleProps = {
  message: TranscriptMessage;
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
  const shouldShowAssistantMeta =
    message.role === "assistant" &&
    Boolean(message.modelLabel || message.modelSource);

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
              colorScheme={colorScheme}
            />
          ) : null}

          {shouldShowAssistantBodyFallback ? (
            <AssistantMarkdownMessage
              content={message.body}
              pending={message.pending}
              palette={palette}
              colorScheme={colorScheme}
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
                  colorScheme={colorScheme}
                />
              ))}
            </View>
          ) : null}

          {shouldShowAssistantMeta ? (
            <View style={styles.assistantMeta}>
              {message.modelLabel ? (
                <ThemedText style={styles.assistantMetaPrimary}>
                  {message.modelLabel}
                </ThemedText>
              ) : null}
              {message.modelSource ? (
                <ThemedText
                  style={[
                    styles.assistantMetaSecondary,
                    { color: palette.mutedText },
                  ]}
                >
                  {message.modelSource}
                </ThemedText>
              ) : null}
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

function AssistantMarkdownMessage({
  content,
  pending,
  palette,
  colorScheme,
}: {
  content: string;
  pending: boolean;
  palette: (typeof Colors)["light"];
  colorScheme: "light" | "dark";
}) {
  const markdownStyles = useMemo(() => createMarkdownStyles(palette), [palette]);
  const markdownRenderers = useMemo<Partial<Renderers>>(
    () => ({
      CodeRenderer: ({ node }) => (
        <CodeBlock
          key={node.position?.start.offset ?? node.value}
          node={node}
          palette={palette}
          colorScheme={colorScheme}
          inheritedStyles={undefined}
        />
      ),
    }),
    [palette, colorScheme],
  );

  return (
    <View
      style={[
        styles.assistantMarkdownShell,
        pending ? styles.pendingBody : null,
      ]}
    >
      <Markdown
        markdown={content}
        theme={themes.defaultTheme}
        customRenderers={markdownRenderers}
        customStyles={markdownStyles}
        onLinkPress={(url: string) => {
          void Linking.openURL(url);
        }}
      />
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
          color: palette.toolRunningText,
        }
      : status === "failed"
        ? {
            color: palette.toolFailedText,
          }
        : {
            color: palette.toolCompletedText,
          };

  return (
    <View
      style={[
        styles.toolCard,
        {
          backgroundColor: palette.thinkingBackground,
          borderColor: palette.thinkingBorder,
        },
      ]}
    >
      <View style={styles.toolHeader}>
        <IconSymbol
          name="chevron.right"
          size={12}
          color={palette.icon}
          style={styles.toolChevron}
        />
        <ThemedText
          type="defaultSemiBold"
          style={styles.toolName}
          numberOfLines={1}
        >
          {name}
        </ThemedText>
        <ThemedText style={[styles.toolStatusText, { color: toneStyle.color }]}>
          {formatToolStatus(status)}
        </ThemedText>
      </View>
      {summary && summary !== "No arguments" ? (
        <ThemedText
          style={[styles.toolSummary, { color: palette.text }]}
          selectable
        >
          {summary}
        </ThemedText>
      ) : null}
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
          size={11}
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
  colorScheme,
}: {
  item: TranscriptMessage;
  segment: TranscriptMessageSegment;
  isLiveThinking: boolean;
  palette: (typeof Colors)["light"];
  colorScheme: "light" | "dark";
}) {
  if (segment.type === "text") {
    return (
      <AssistantMarkdownMessage
        content={segment.content}
        pending={item.pending}
        palette={palette}
        colorScheme={colorScheme}
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

function CodeBlock({
  node,
  palette,
  colorScheme,
  inheritedStyles,
}: {
  node: Parameters<Renderers["CodeRenderer"]>[0]["node"];
  palette: (typeof Colors)["light"];
  colorScheme: "light" | "dark";
  inheritedStyles: StyleProp<ViewStyle>;
}) {
  const content =
    node.value.endsWith("\n") ? node.value.slice(0, -1) : node.value;
  const language = normalizeCodeLanguage(node.lang);
  const grammar = resolvePrismGrammar(language);
  const tokens = Prism.tokenize(content, grammar) as (PrismToken | string)[];
  const tokenColors = getCodeTokenColors(colorScheme);

  return (
    <View
      style={[
        inheritedStyles,
        {
          backgroundColor: palette.codeBackground,
          borderRadius: Radii.surface,
          overflow: "hidden",
          marginBottom: 8,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: 8,
        }}
      >
        <Text
          style={[
            styles.codeText,
            {
              color: palette.text,
            },
          ]}
        >
          {renderPrismTokens(tokens, tokenColors)}
        </Text>
      </ScrollView>
    </View>
  );
}

function normalizeCodeLanguage(languageHint?: string | null) {
  const language = languageHint?.trim().toLowerCase() ?? "";

  switch (language) {
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "jsx":
      return "javascript";
    case "sh":
    case "shell":
    case "zsh":
      return "bash";
    case "yml":
      return "yaml";
    case "md":
      return "markdown";
    case "html":
    case "xml":
      return "markup";
    default:
      return language;
  }
}

function resolvePrismGrammar(language: string) {
  return Prism.languages[language] ?? {};
}

type PrismToken = {
  type: string;
  content: string | (PrismToken | string)[];
};

function getCodeTokenColors(colorScheme: "light" | "dark") {
  return colorScheme === "dark"
    ? {
        comment: "#7F848E",
        keyword: "#C678DD",
        string: "#98C379",
        number: "#D19A66",
        boolean: "#D19A66",
        function: "#61AFEF",
        className: "#E5C07B",
        tag: "#E06C75",
        operator: "#56B6C2",
        punctuation: "#ABB2BF",
        property: "#D19A66",
      }
    : {
        comment: "#A0A1A7",
        keyword: "#A626A4",
        string: "#50A14F",
        number: "#986801",
        boolean: "#986801",
        function: "#4078F2",
        className: "#C18401",
        tag: "#E45649",
        operator: "#0184BC",
        punctuation: "#383A42",
        property: "#986801",
      };
}

function renderPrismTokens(
  tokens: (PrismToken | string)[],
  tokenColors: ReturnType<typeof getCodeTokenColors>,
  keyPrefix = "code",
): ReactNode[] {
  return tokens.flatMap((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (typeof token === "string") {
      return token;
    }

    const style = getTokenStyle(token, tokenColors);
    const children =
      typeof token.content === "string"
        ? token.content
        : renderPrismTokens(token.content as (PrismToken | string)[], tokenColors, key);

    return (
      <Text key={key} style={style}>
        {children}
      </Text>
    );
  });
}

function getTokenStyle(
  token: PrismToken,
  tokenColors: ReturnType<typeof getCodeTokenColors>,
) {
  const type = token.type;

  switch (type) {
    case "comment":
    case "prolog":
    case "doctype":
    case "cdata":
      return { color: tokenColors.comment, fontStyle: "italic" as const };
    case "keyword":
    case "atrule":
    case "rule":
    case "important":
      return { color: tokenColors.keyword };
    case "string":
    case "char":
    case "attr-value":
      return { color: tokenColors.string };
    case "number":
    case "boolean":
    case "constant":
    case "symbol":
      return { color: tokenColors.number };
    case "function":
    case "method":
    case "class-name":
      return { color: tokenColors.function };
    case "tag":
    case "selector":
      return { color: tokenColors.tag };
    case "operator":
    case "entity":
      return { color: tokenColors.operator };
    case "punctuation":
      return { color: tokenColors.punctuation };
    case "property":
    case "attr-name":
      return { color: tokenColors.property };
    default:
      return undefined;
  }
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
    container: {
      gap: 0,
    },
    paragraph: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 0,
      marginBottom: 6,
    },
    text: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
    heading: (level: number) => ({
      color: palette.text,
      fontSize: level === 1 ? 19 : level === 2 ? 17 : 15,
      lineHeight: level === 1 ? 24 : level === 2 ? 22 : 20,
      fontWeight: "700" as const,
      marginTop: 0,
      marginBottom: 6,
    }),
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: palette.border,
      paddingLeft: 12,
      marginLeft: 0,
      marginBottom: 6,
    },
    list: {
      marginTop: 0,
      marginBottom: 6,
    },
    listItem: {
      color: palette.text,
      marginBottom: 4,
    },
    strong: {
      color: palette.text,
      fontWeight: "700" as const,
    },
    emphasis: {
      color: palette.text,
      fontStyle: "italic" as const,
    },
    inlineCode: {
      color: palette.text,
      backgroundColor: palette.codeBackground,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: Radii.surface,
      fontFamily: Fonts.mono,
    },
    link: {
      color: palette.tint,
      textDecorationLine: "underline" as const,
    },
    linkReference: {
      color: palette.tint,
      textDecorationLine: "underline" as const,
    },
    thematicBreak: {
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
    borderRadius: Radii.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  assistantBubble: {
    borderBottomLeftRadius: Radii.surface,
  },
  userBubble: {
    borderBottomRightRadius: Radii.surface,
  },
  userMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  codeText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  assistantMarkdownShell: {
    width: "100%",
  },
  pendingBody: {
    opacity: 0.7,
  },
  segmentList: {
    width: "100%",
    gap: 2,
  },
  assistantMeta: {
    marginTop: 4,
    gap: 1,
  },
  assistantMetaPrimary: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  assistantMetaSecondary: {
    fontSize: 11,
    lineHeight: 14,
  },
  toolCard: {
    borderWidth: 1,
    borderRadius: Radii.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  toolHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toolChevron: {
    marginRight: -2,
  },
  toolName: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
  },
  toolStatusText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  toolSummary: {
    marginTop: 6,
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 15,
  },
  thinkingShell: {
    borderWidth: 1,
    borderRadius: Radii.surface,
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
    borderRadius: Radii.surface,
    padding: 10,
  },
});
