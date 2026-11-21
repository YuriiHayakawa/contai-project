// Estado de carregamento de uma tela (Princípio IX).
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export function LoadingState({ message = "Carregando…" }: { message?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.center}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator color={colors.primary} />
      <Text variant="small" color="inkMuted">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space[3], paddingVertical: space[8] },
});
