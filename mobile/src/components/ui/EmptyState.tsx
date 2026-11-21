// Estado vazio de uma tela (design-system, seção 6.7): diz o que fazer e oferece a ação.
import { StyleSheet, View } from "react-native";

import { space } from "@/theme/tokens";

import { Button } from "./Button";
import { Text } from "./Text";

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <Text variant="title2" accessibilityRole="header" style={styles.centerText}>
        {title}
      </Text>
      <Text variant="body" color="inkMuted" style={styles.centerText}>
        {description}
      </Text>
      {actionLabel && onAction && <Button label={actionLabel} onPress={onAction} />}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "stretch", gap: space[3], paddingVertical: space[8], maxWidth: 320 },
  centerText: { textAlign: "center" },
});
