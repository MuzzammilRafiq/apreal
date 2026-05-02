import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function TypingIndicator() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={styles.row}>
      <View style={styles.content}>
        <View style={styles.dotRow}>
          {[0, 1, 2].map((dot) => (
            <View
              key={dot}
              style={[
                styles.dot,
                {
                  backgroundColor: palette.mutedText,
                  opacity: 0.4 + dot * 0.2,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  content: {
    paddingVertical: 4,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 0,
  },
});
