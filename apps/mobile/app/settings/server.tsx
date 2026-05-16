import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

import { getSearchableModels } from "@/lib/settings-model-utils";

export default function ServerSettingsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    providers,
    providersLoaded,
    loadingProviders,
    refreshProviders,
  } = useChatClient();

  useEffect(() => {
    void refreshProviders().catch(() => {
      // The provider load error is surfaced through shared screen state.
    });
  }, [refreshProviders]);

  const searchableModels = useMemo(() => getSearchableModels(providers), [providers]);

  const currentDefaultModel = useMemo(
    () => searchableModels.find((model) => model.isDefault) ?? null,
    [searchableModels],
  );
  const totalModels = searchableModels.length;

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View
        style={[
          styles.header,
          {
            borderBottomColor: palette.border,
            backgroundColor: palette.headerBackground,
          },
        ]}
      >
        <View style={styles.headerCopy}>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
            Server settings
          </ThemedText>
          <ThemedText
            style={[styles.headerSubtitle, { color: palette.mutedText }]}
          >
            Model defaults
          </ThemedText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.cardBackground,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <ThemedText type="defaultSemiBold">Agent login and models</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload models"
              onPress={() => {
                void refreshProviders().catch(() => {
                  // The provider load error is surfaced through shared screen state.
                });
              }}
              disabled={loadingProviders}
              style={[
                styles.inlineButton,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.cardBackground,
                  opacity: loadingProviders ? 0.6 : 1,
                },
              ]}
            >
              <ThemedText
                style={[styles.inlineButtonText, { color: palette.text }]}
              >
                {loadingProviders ? "Loading..." : "Refresh"}
              </ThemedText>
            </Pressable>
          </View>

          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            Provider sign-in stays on the paired computer. Use the Pi CLI there,
            then run /login and /model to choose the subscription or model this
            app should use for new chats.
          </ThemedText>

          <View
            style={[
              styles.featuredModelCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <View
              style={[
                styles.featuredModelIcon,
                {
                  backgroundColor: palette.cardPressed,
                  borderColor: palette.border,
                },
              ]}
            >
              <Ionicons
                name={
                  loadingProviders && !providersLoaded
                    ? "hourglass-outline"
                    : currentDefaultModel
                      ? "checkmark-circle"
                      : "sparkles-outline"
                }
                size={20}
                color={palette.text}
              />
            </View>

            <View style={styles.featuredModelCopy}>
              {loadingProviders && !providersLoaded ? (
                <>
                  <ThemedText
                    type="defaultSemiBold"
                    style={styles.featuredModelTitle}
                  >
                    Fetching available models...
                  </ThemedText>
                  <ThemedText
                    style={[styles.featuredModelBody, { color: palette.mutedText }]}
                  >
                    The paired server is loading provider state and available model options.
                  </ThemedText>
                </>
              ) : (
                <>
                  <View style={styles.featuredModelHeader}>
                    <ThemedText
                      type="defaultSemiBold"
                      style={styles.featuredModelTitle}
                    >
                      {currentDefaultModel?.modelName ?? "Choose a model for new chats"}
                    </ThemedText>

                    {currentDefaultModel ? (
                      <View style={styles.modelHeaderMeta}>
                        <View
                          style={[
                            styles.modelTag,
                            {
                              backgroundColor: palette.cardPressed,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[styles.modelTagText, { color: palette.text }]}
                          >
                            {currentDefaultModel.providerLabel}
                          </ThemedText>
                        </View>
                        <View
                          style={[
                            styles.modelTag,
                            {
                              backgroundColor: palette.cardPressed,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[styles.modelTagText, { color: palette.text }]}
                          >
                            {currentDefaultModel.authType === "oauth"
                              ? "Subscription"
                              : "API key"}
                          </ThemedText>
                        </View>
                        <View
                          style={[
                            styles.currentBadge,
                            {
                              backgroundColor: palette.cardPressed,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.currentBadgeText,
                              { color: palette.text },
                            ]}
                          >
                            Current
                          </ThemedText>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <ThemedText
                    style={[styles.featuredModelMeta, { color: palette.mutedText }]}
                  >
                    {currentDefaultModel?.modelId ?? "No default model selected yet."}
                  </ThemedText>

                  {!currentDefaultModel ? (
                    <ThemedText
                      style={[styles.featuredModelBody, { color: palette.mutedText }]}
                    >
                      Open the full model list to browse all available models and pick one.
                    </ThemedText>
                  ) : null}
                </>
              )}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all models"
            onPress={() => router.push("/settings/models")}
            style={({ pressed }) => [
              styles.modelBrowseButton,
              {
                backgroundColor: pressed ? palette.cardPressed : palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.modelBrowseCopy}>
              <ThemedText type="defaultSemiBold" style={styles.modelBrowseTitle}>
                View all models
              </ThemedText>
              <ThemedText
                style={[styles.modelBrowseMeta, { color: palette.mutedText }]}
              >
                {!providersLoaded && loadingProviders
                  ? "Loading available models..."
                  : totalModels === 0
                    ? "No models available yet"
                    : `${totalModels} model${totalModels === 1 ? "" : "s"} available`}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.text} />
          </Pressable>

          {providersLoaded && providers && providers.providers.length === 0 ? (
            <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
              No providers are configured yet.
            </ThemedText>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerCopy: {
    flex: 1,
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
  content: {
    padding: 12,
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 16,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
  },
  inlineButton: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlineButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  featuredModelCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    gap: 8,
  },
  featuredModelIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredModelCopy: {
    flex: 1,
    gap: 4,
  },
  featuredModelHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  featuredModelEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  featuredModelTitle: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
  },
  featuredModelMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
  featuredModelBody: {
    fontSize: 11,
    lineHeight: 15,
  },
  modelBrowseButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modelBrowseCopy: {
    flex: 1,
    gap: 2,
  },
  modelBrowseTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  modelBrowseMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
  searchShell: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    paddingVertical: 0,
  },
  searchClearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  resultsSummary: {
    gap: 4,
  },
  resultsCountPill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  resultsCountText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  helperText: {
    fontSize: 11,
    lineHeight: 16,
  },
  feedbackCard: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modelCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  modelAccent: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modelCopy: {
    flex: 1,
    gap: 3,
  },
  modelHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  modelHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  modelTitle: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  modelTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  modelTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modelTagText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  modelMeta: {
    fontSize: 11,
    lineHeight: 14,
  },
  currentBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  modelAction: {
    minWidth: 48,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
  },
  modelActionText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
});
