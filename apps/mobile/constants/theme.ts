/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from "react-native";

const tintColorLight = "#000000";
const tintColorDark = "#FFFFFF";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#FFFFFF",
    surface: "#FFFFFF",
    headerBackground: "#FFFFFF",
    cardBackground: "#FFFFFF",
    cardPressed: "#F2F2F2",
    tint: "#000000",
    icon: "#5C5C5C",
    border: "#D9D9D9",
    borderStrong: "#BFBFBF",
    mutedText: "#5F6B7A",
    assistantBubble: "#FFFFFF",
    assistantAccent: "#F2F2F2",
    userBubble: "#000000",
    userBubbleText: "#FFFFFF",
    composerBackground: "#FFFFFF",
    codeBackground: "#F5F5F5",
    toolBackground: "#FAFAFA",
    toolRunningBackground: "#F2F2F2",
    toolCompletedBackground: "#F2F2F2",
    toolFailedBackground: "#F2F2F2",
    toolRunningText: "#000000",
    toolCompletedText: "#000000",
    toolFailedText: "#000000",
    thinkingBackground: "#FAFAFA",
    thinkingBorder: "#E3E3E3",
    dangerBackground: "#FFF1F0",
    dangerText: "#A63D38",
    statusConnected: "#2F6B39",
    statusDisconnected: "#A63D38",
    statusPending: "#8D6A17",
    tabIconDefault: "#7A7A7A",
    tabIconSelected: "#000000",
  },
  dark: {
    text: "#F5F5F5",
    background: "#000000",
    surface: "#111111",
    headerBackground: "#000000",
    cardBackground: "#111111",
    cardPressed: "#1A1A1A",
    tint: tintColorDark,
    icon: "#A8A8A8",
    border: "#2A2A2A",
    borderStrong: "#3A3A3A",
    mutedText: "#B0B0B0",
    assistantBubble: "#111111",
    assistantAccent: "#1A1A1A",
    userBubble: "#FFFFFF",
    userBubbleText: "#000000",
    composerBackground: "#111111",
    codeBackground: "#151515",
    toolBackground: "#121212",
    toolRunningBackground: "#1A1A1A",
    toolCompletedBackground: "#1A1A1A",
    toolFailedBackground: "#1A1A1A",
    toolRunningText: "#FFFFFF",
    toolCompletedText: "#FFFFFF",
    toolFailedText: "#FFFFFF",
    thinkingBackground: "#121212",
    thinkingBorder: "#2A2A2A",
    dangerBackground: "#2A1819",
    dangerText: "#FFADA9",
    statusConnected: "#8FD6A0",
    statusDisconnected: "#FFADA9",
    statusPending: "#F0CF78",
    tabIconDefault: "#A8A8A8",
    tabIconSelected: "#FFFFFF",
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
