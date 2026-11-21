// Estado de erro de uma tela: o que aconteceu e o que fazer (Princípio IX).
import { StyleSheet, View } from "react-native";

import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";
import { Text } from "./Text";

export interface ErrorStateProps {
  title?: string;
  /** O que aconteceu e o que fazer; as mensagens da API já vêm assim. */
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Não foi possível carregar",
  message,
  onRetry,
}: ErrorStateProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.dangerSoft }]}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" color="ink" accessibilityRole="alert" accessibilityLiveRegion="polite">
        {message}
      </Text>
      {onRetry && <Button label="Tentar de novo" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space[4], gap: space[3] },
});
