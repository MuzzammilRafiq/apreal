import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useChatClient } from "@/providers/chat-client-provider";

export default function ServerSettingsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { connected, pairingReady, pairingState, lastError, clearError } =
    useChatClient();

  const pairingTitle = pairingReady ? "Device paired" : "Waiting for pairing";
  const pairingBody = pairingReady
    ? "This device is already paired. Future relay connections will keep using the stored client identity."
    : "Paste this code into the agent server. Chat stays locked until the relay marks this phone as paired.";

  function handleBackNavigation() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={handleBackNavigation}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={20} color={palette.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
            Relay settings
          </ThemedText>
          <ThemedText
            style={[styles.headerSubtitle, { color: palette.mutedText }]}
          >
            Pairing only
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
              <ThemedText style={[styles.errorText, { color: palette.dangerText }]}> 
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
    width: 36,
    height: 36,
    borderRadius: 0,
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
  content: {
    padding: 16,
    gap: 14,
  },
  card: {
    borderWidth: 1,
    borderRadius: 0,
    padding: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusPill: {
    borderRadius: 0,
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
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
