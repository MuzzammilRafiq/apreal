import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

type SearchableModel = {
  key: string;
  providerId: string;
  providerLabel: string;
  authType: "oauth" | "api_key";
  modelId: string;
  modelName: string;
  label: string;
  searchText: string;
  isDefault: boolean;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function formatProviderId(id: string) {
  return id
    .split("-")
    .map((part) => {
      if (!part) {
        return part;
      }

      if (part.length <= 3) {
        return part.toUpperCase();
      }

      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
    })
    .join(" ");
}

export default function ServerSettingsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const {
    connected,
    pairingReady,
    pairingState,
    lastError,
    clearError,
    providers,
    providersLoaded,
    loadingProviders,
    refreshProviders,
    updateDefaultModel,
  } = useChatClient();
  const [modelQuery, setModelQuery] = useState("");
  const [modelUpdateError, setModelUpdateError] = useState<string | null>(null);
  const [modelUpdateMessage, setModelUpdateMessage] = useState<string | null>(null);
  const [savingModelKey, setSavingModelKey] = useState<string | null>(null);

  const pairingTitle = pairingReady ? "Device paired" : "Waiting for pairing";
  const pairingBody = pairingReady
    ? "This device is already paired. Future relay connections will keep using the stored client identity."
    : "Paste this code into the agent server. Chat stays locked until the relay marks this phone as paired.";

  useEffect(() => {
    if (!pairingReady) {
      return;
    }

    void refreshProviders().catch(() => {
      // The provider load error is surfaced through shared screen state.
    });
  }, [pairingReady, refreshProviders]);

  const searchableModels = useMemo(() => {
    if (!providers) {
      return [] as SearchableModel[];
    }

    const flattened = providers.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.id}:${model.id}`,
        providerId: provider.id,
        providerLabel: formatProviderId(provider.id),
        authType: provider.authType,
        modelId: model.id,
        modelName: model.name,
        isDefault:
          provider.id === providers.defaultProvider &&
          model.id === providers.defaultModel,
      })),
    );
    const duplicateNameCounts = new Map<string, number>();

    for (const item of flattened) {
      const key = normalizeSearchValue(item.modelName);
      duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1);
    }

    return flattened
      .map((item) => {
        const duplicateNameCount =
          duplicateNameCounts.get(normalizeSearchValue(item.modelName)) ?? 0;
        const label =
          duplicateNameCount > 1
            ? `${item.modelName} (${item.providerLabel})`
            : item.modelName;

        return {
          ...item,
          label,
          searchText: normalizeSearchValue(
            `${item.modelName} ${item.modelId} ${item.providerLabel} ${item.providerId}`,
          ),
        };
      })
      .sort(
        (left, right) =>
          Number(right.isDefault) - Number(left.isDefault) ||
          left.modelName.localeCompare(right.modelName) ||
          left.providerLabel.localeCompare(right.providerLabel) ||
          left.modelId.localeCompare(right.modelId),
      );
  }, [providers]);

  const normalizedModelQuery = normalizeSearchValue(modelQuery);
  const visibleModels = useMemo(() => {
    if (normalizedModelQuery) {
      return searchableModels.filter((model) =>
        model.searchText.includes(normalizedModelQuery),
      );
    }

    return searchableModels.filter((model) => model.isDefault).slice(0, 1);
  }, [normalizedModelQuery, searchableModels]);

  const currentDefaultModel = useMemo(
    () => searchableModels.find((model) => model.isDefault) ?? null,
    [searchableModels],
  );

  async function handleSelectModel(providerId: string, modelId: string) {
    const key = `${providerId}:${modelId}`;
    setSavingModelKey(key);
    setModelUpdateError(null);
    setModelUpdateMessage(null);

    try {
      await updateDefaultModel(providerId, modelId);
      setModelUpdateMessage("Default model updated for new chats.");
    } catch (error) {
      setModelUpdateError(
        error instanceof Error
          ? error.message
          : "Failed to update the default model.",
      );
    } finally {
      setSavingModelKey(null);
    }
  }

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
            Relay pairing and model defaults
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
          <View style={styles.statusRow}>
            <ThemedText type="defaultSemiBold">{pairingTitle}</ThemedText>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: connected
                    ? palette.toolCompletedBackground
                    : palette.toolFailedBackground,
                },
              ]}
            >
              <ThemedText
                style={{
                  color: connected
                    ? palette.statusConnected
                    : palette.statusDisconnected,
                  fontSize: 12,
                  lineHeight: 16,
                  fontWeight: "700",
                }}
              >
                {connected ? "Connected" : "Disconnected"}
              </ThemedText>
            </View>
          </View>

          <ThemedText style={[styles.pairingCode, { color: palette.text }]}>
            {pairingReady ? "Paired" : pairingState?.pairingCode ?? "Issuing..."}
          </ThemedText>
          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            {pairingBody}
          </ThemedText>
        </View>

        {lastError ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: palette.dangerBackground,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.errorRow}>
              <ThemedText
                style={[styles.errorText, { color: palette.dangerText }]}
              >
                {lastError}
              </ThemedText>
              <Pressable onPress={clearError} style={styles.dismissButton}>
                <Ionicons name="close" size={18} color={palette.dangerText} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.cardBackground,
              borderColor: palette.border,
            },
          ]}
        >
          <ThemedText type="defaultSemiBold">Pairing flow</ThemedText>
          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            1. Wait for this screen to show a pairing code.
          </ThemedText>
          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            2. Copy that code into the agent server once.
          </ThemedText>
          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            3. Keep this app open until the relay reports the device as paired.
          </ThemedText>
          <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
            4. After pairing, this device reconnects with its stored relay identity.
          </ThemedText>
        </View>

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
                if (!pairingReady) {
                  return;
                }

                void refreshProviders().catch(() => {
                  // The provider load error is surfaced through shared screen state.
                });
              }}
              disabled={loadingProviders || !pairingReady}
              style={[
                styles.inlineButton,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.cardBackground,
                  opacity: loadingProviders || !pairingReady ? 0.6 : 1,
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

          {!pairingReady ? (
            <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
              Pair this device first to browse and change the default model.
            </ThemedText>
          ) : (
            <>
              <TextInput
                value={modelQuery}
                onChangeText={setModelQuery}
                placeholder="Search by model, id, or provider"
                placeholderTextColor={palette.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.searchInput,
                  {
                    color: palette.text,
                    borderColor: palette.border,
                    backgroundColor: palette.surface,
                  },
                ]}
              />

              <ThemedText style={[styles.helperText, { color: palette.mutedText }]}>
                {currentDefaultModel
                  ? normalizedModelQuery
                    ? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}. A default model is configured for new chats.`
                    : "Showing the current default model for new chats."
                  : normalizedModelQuery
                    ? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}. No default model is selected yet.`
                    : "No default model is selected yet. Search to browse available models."}
              </ThemedText>

              {modelUpdateMessage ? (
                <View
                  style={[
                    styles.feedbackCard,
                    {
                      backgroundColor: palette.toolCompletedBackground,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <ThemedText style={{ color: palette.text }}>
                    {modelUpdateMessage}
                  </ThemedText>
                </View>
              ) : null}

              {modelUpdateError ? (
                <View
                  style={[
                    styles.feedbackCard,
                    {
                      backgroundColor: palette.dangerBackground,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <ThemedText style={{ color: palette.dangerText }}>
                    {modelUpdateError}
                  </ThemedText>
                </View>
              ) : null}

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

                return (
                  <View
                    key={model.key}
                    style={[
                      styles.modelCard,
                      {
                        backgroundColor: model.isDefault
                          ? palette.toolCompletedBackground
                          : palette.cardBackground,
                        borderColor: model.isDefault
                          ? palette.borderStrong
                          : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.modelCopy}>
                      <View style={styles.modelHeader}>
                        <ThemedText
                          type="defaultSemiBold"
                          style={styles.modelTitle}
                        >
                          {model.label}
                        </ThemedText>
                        {model.isDefault ? (
                          <View
                            style={[
                              styles.currentBadge,
                              { backgroundColor: palette.cardPressed },
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
                        ) : null}
                      </View>
                      <ThemedText
                        style={[styles.modelMeta, { color: palette.mutedText }]}
                      >
                        {model.modelId}
                      </ThemedText>
                      <ThemedText
                        style={[styles.modelMeta, { color: palette.mutedText }]}
                      >
                        {model.providerLabel} · {model.authType === "oauth" ? "Subscription" : "API key"}
                      </ThemedText>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        model.isDefault
                          ? `${model.label} is the current default model`
                          : `Use ${model.label} as the default model`
                      }
                      onPress={() => {
                        void handleSelectModel(model.providerId, model.modelId);
                      }}
                      disabled={
                        isSaving || model.isDefault || savingModelKey !== null
                      }
                      style={[
                        styles.modelButton,
                        {
                          borderColor: palette.border,
                          backgroundColor: model.isDefault
                            ? palette.cardPressed
                            : palette.surface,
                          opacity:
                            isSaving || model.isDefault || savingModelKey !== null
                              ? 0.6
                              : 1,
                        },
                      ]}
                    >
                      <ThemedText style={{ color: palette.text }}>
                        {isSaving
                          ? "Saving..."
                          : model.isDefault
                            ? "Current"
                            : "Use model"}
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })}

              {providersLoaded && visibleModels.length === 0 ? (
                <ThemedText style={[styles.copy, { color: palette.mutedText }]}>
                  {normalizedModelQuery
                    ? `No available models match "${modelQuery.trim()}".`
                    : currentDefaultModel
                      ? "The current default model is shown above."
                      : "No default model is selected yet. Search to browse available models."}
                </ThemedText>
              ) : null}
            </>
          )}
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
    padding: 16,
    gap: 14,
  },
  card: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusPill: {
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pairingCode: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: 0.4,
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
  searchInput: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 18,
  },
  feedbackCard: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modelCard: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    gap: 12,
  },
  modelCopy: {
    gap: 4,
  },
  modelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modelTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  modelMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  currentBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  currentBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  modelButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
});
