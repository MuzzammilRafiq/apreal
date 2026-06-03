import { StyleSheet } from "react-native";
import type { Colors } from "@/constants/theme";
import { Fonts, Radii } from "@/constants/theme";

export function createMarkdownStyles(palette: (typeof Colors)["light"]) {
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

export const styles = StyleSheet.create({
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

