/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from "react-native";

const tintColorLight = "#0a7ea4";
const tintColorDark = "#fff";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#F5F7FB",
    surface: "#FFFFFF",
    headerBackground: "#F5F7FB",
    cardBackground: "#FFFFFF",
    cardPressed: "#EEF3FF",
    tint: "#6750FF",
    icon: "#687076",
    border: "#DCE3F0",
    borderStrong: "#C3CCE0",
    mutedText: "#5F6B7A",
    assistantBubble: "#FFFFFF",
    assistantAccent: "#DCE3FF",
    userBubble: "#6750FF",
    userBubbleText: "#FFFFFF",
    composerBackground: "#FFFFFF",
    codeBackground: "#EEF2FF",
    toolBackground: "#F5F7FF",
    toolRunningBackground: "#EEF4FF",
    toolCompletedBackground: "#F2F8F0",
    toolFailedBackground: "#FFF1F0",
    toolRunningText: "#3156A6",
    toolCompletedText: "#2F6B39",
    toolFailedText: "#A63D38",
    thinkingBackground: "#F5F7FA",
    thinkingBorder: "#D7DEE8",
    dangerBackground: "#FFF1F0",
    dangerText: "#A63D38",
    statusConnected: "#2F6B39",
    statusDisconnected: "#A63D38",
    statusPending: "#8D6A17",
    tabIconDefault: "#687076",
    tabIconSelected: "#6750FF",
  },
  dark: {
    text: "#ECEDEE",
    background: "#0F1218",
    surface: "#171B22",
    headerBackground: "#0F1218",
    cardBackground: "#171B22",
    cardPressed: "#1D2430",
    tint: tintColorDark,
    icon: "#9BA1A6",
    border: "#2A3240",
    borderStrong: "#3A4558",
    mutedText: "#98A1B2",
    assistantBubble: "#171B22",
    assistantAccent: "#313B5A",
    userBubble: "#8D7CFF",
    userBubbleText: "#FFFFFF",
    composerBackground: "#171B22",
    codeBackground: "#10151E",
    toolBackground: "#151C26",
    toolRunningBackground: "#17243A",
    toolCompletedBackground: "#17271E",
    toolFailedBackground: "#2A1819",
    toolRunningText: "#9CB8FF",
    toolCompletedText: "#8FD6A0",
    toolFailedText: "#FFADA9",
    thinkingBackground: "#131922",
    thinkingBorder: "#2A3240",
    dangerBackground: "#2A1819",
    dangerText: "#FFADA9",
    statusConnected: "#8FD6A0",
    statusDisconnected: "#FFADA9",
    statusPending: "#F0CF78",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
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
