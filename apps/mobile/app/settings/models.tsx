import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

import {
  getSearchableModels,
  normalizeSearchValue,
} from "@/lib/settings-model-utils";

export default function ModelListScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const {
    clearError,
    lastError,
    pairingReady,
    providers,
    providersLoaded,
    loadingProviders,
    refreshProviders,
    updateDefaultModel,
  } = useChatClient();
  const [modelQuery, setModelQuery] = useState("");
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenMessage, setScreenMessage] = useState<string | null>(null);
  const [savingModelKey, setSavingModelKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pairingReady) {
      return;
    }

    void refreshProviders().catch(() => {
      // Provider load errors are exposed via shared screen state.
    });
  }, [pairingReady, refreshProviders]);

  const searchableModels = useMemo(() => getSearchableModels(providers), [providers]);
  const normalizedModelQuery = normalizeSearchValue(modelQuery);
  const visibleModels = useMemo(() => {
    if (!normalizedModelQuery) {
      return searchableModels;
    }

    return searchableModels.filter((model) =>
      model.searchText.includes(normalizedModelQuery),
    );
  }, [normalizedModelQuery, searchableModels]);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/settings/server");
  }

  async function handleSelectModel(providerId: string, modelId: string) {
    const key = `${providerId}:${modelId}`;
    setSavingModelKey(key);
    setScreenError(null);
    setScreenMessage(null);

    try {
      await updateDefaultModel(providerId, modelId);
      setScreenMessage("Default model updated for new chats.");
    } catch (error) {
      setScreenError(
        error instanceof Error ? error.message : "Failed to update the default model.",
      );
    } finally {
      setSavingModelKey(null);
    }
  }

  const resultsLabel = normalizedModelQuery
    ? `${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}`
    : `${visibleModels.length} model${visibleModels.length === 1 ? "" : "s"}`;
  const headerSubtitle = normalizedModelQuery
    ? `${visibleModels.length} of ${searchableModels.length} shown`
    : `${searchableModels.length} available`;

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={handleBack}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={20} color={palette.text} />
        </Pressable>

        <View style={styles.headerCopy}>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
            All models
          </ThemedText>
          <ThemedText
            style={[styles.headerSubtitle, { color: palette.mutedText }]}
            numberOfLines={1}
          >
            {pairingReady ? headerSubtitle : "Pair this device to browse models"}
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh models"
          onPress={() => {
            if (!pairingReady) {
              return;
            }

            setScreenError(null);
            void refreshProviders().catch(() => {
              // Provider load errors are exposed via shared screen state.
            });
          }}
          disabled={!pairingReady || loadingProviders}
          style={({ pressed }) => [
            styles.headerButton,
            {
              backgroundColor: pressed ? palette.cardPressed : palette.cardBackground,
              borderColor: palette.border,
              opacity: !pairingReady || loadingProviders ? 0.55 : 1,
            },
          ]}
        >
          <Ionicons name="refresh-outline" size={18} color={palette.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {screenMessage ? (
          <View
            style={[
              styles.feedbackCard,
              {
                backgroundColor: palette.toolCompletedBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <ThemedText style={{ color: palette.text }}>{screenMessage}</ThemedText>
          </View>
        ) : null}

        {screenError || lastError ? (
          <View
            style={[
              styles.feedbackCard,
              {
                backgroundColor: palette.dangerBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.errorRow}>
              <ThemedText style={[styles.errorText, { color: palette.dangerText }]}>
                {screenError ?? lastError}
              </ThemedText>
              <Pressable
                onPress={() => {
                  setScreenError(null);
                  clearError();
                }}
                style={styles.dismissButton}
              >
                <Ionicons name="close" size={18} color={palette.dangerText} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {!pairingReady ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: palette.cardBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <ThemedText type="defaultSemiBold">Waiting for pairing</ThemedText>
            <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
              Pair this device first to browse and change the default model.
            </ThemedText>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.searchShell,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.surface,
                },
              ]}
            >
              <Ionicons name="search" size={18} color={palette.mutedText} />
              <TextInput
                value={modelQuery}
                onChangeText={setModelQuery}
                placeholder="Search models, ids, or providers"
                placeholderTextColor={palette.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.searchInput, { color: palette.text }]}
              />
              {modelQuery.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear model search"
                  onPress={() => setModelQuery("")}
                  style={[
                    styles.searchClearButton,
                    { backgroundColor: palette.cardPressed },
                  ]}
                >
                  <Ionicons name="close" size={14} color={palette.text} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.resultsSummary}>
              <View
                style={[
                  styles.resultsCountPill,
                  {
                    backgroundColor: palette.cardPressed,
                    borderColor: palette.border,
                  },
                ]}
              >
                <ThemedText style={[styles.resultsCountText, { color: palette.text }]}>
                  {resultsLabel}
                </ThemedText>
              </View>
              <ThemedText style={[styles.helperText, { color: palette.mutedText }]}>
                Tap any model below to make it the default for new chats.
              </ThemedText>
            </View>

            {!providersLoaded && loadingProviders ? (
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                Loading available models...
              </ThemedText>
            ) : null}

            {providersLoaded && providers && providers.providers.length === 0 ? (
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                No providers are configured yet.
              </ThemedText>
            ) : null}

            {visibleModels.map((model) => {
              const isSaving = savingModelKey === model.key;
              const isDisabled =
                isSaving || model.isDefault || savingModelKey !== null;

              return (
                <Pressable
                  key={model.key}
                  accessibilityRole="button"
                  accessibilityLabel={
                    model.isDefault
                      ? `${model.label} is the current default model`
                      : `Use ${model.label} as the default model`
                  }
                  onPress={() => {
                    void handleSelectModel(model.providerId, model.modelId);
                  }}
                  disabled={isDisabled}
                  style={({ pressed }) => [
                    styles.modelCard,
                    {
                      backgroundColor: model.isDefault
                        ? palette.toolCompletedBackground
                        : palette.surface,
                      borderColor: model.isDefault
                        ? palette.borderStrong
                        : palette.border,
                      opacity: isDisabled ? 0.68 : 1,
                    },
                    pressed && !isDisabled
                      ? { backgroundColor: palette.cardPressed }
                      : null,
                  ]}
                >
                  <View style={styles.modelRow}>
                    <View style={styles.modelCopy}>
                      <View style={styles.modelHeader}>
                        <ThemedText
                          type="defaultSemiBold"
                          style={styles.modelTitle}
                          numberOfLines={1}
                        >
                          {model.modelName}
                        </ThemedText>

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
                              {model.providerLabel}
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
                              {model.authType === "oauth" ? "Subscription" : "API key"}
                            </ThemedText>
                          </View>
                          {isSaving || model.isDefault ? (
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
                                style={[styles.currentBadgeText, { color: palette.text }]}
                              >
                                {isSaving ? "Saving" : "Current"}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <ThemedText
                        style={[styles.modelMeta, { color: palette.mutedText }]}
                        numberOfLines={1}
                      >
                        {model.modelId}
                      </ThemedText>
                    </View>
                  </View>
                </Pressable>
              );
            })}

            {providersLoaded && visibleModels.length === 0 ? (
              <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                {normalizedModelQuery
                  ? `No available models match "${modelQuery.trim()}".`
                  : "No models are available right now."}
              </ThemedText>
            ) : null}
          </>
        )}
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
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 12,
    gap: 10,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 16,
    gap: 8,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
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
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dismissButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
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
});
