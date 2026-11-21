import type { ComponentRef, Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { CONTROL_HEIGHT, TOUCH_TARGET, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  /** Verbo e objeto: "Salvar lançamento", e não "OK" (design-system, seção 6.1). */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Dentro de linhas e cartões: 44 pt, o mínimo de toque. */
  compact?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  ref?: Ref<ComponentRef<typeof View>>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  compact = false,
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
  ref,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  const palette = {
    primary: { background: colors.primary, text: colors.onPrimary, border: colors.primary },
    secondary: { background: colors.surface, text: colors.ink, border: colors.borderStrong },
    ghost: { background: "transparent", text: colors.primary, border: "transparent" },
    danger: { background: colors.danger, text: colors.onDanger, border: colors.danger },
  }[variant];
  const disabledLook = disabled && !loading;

  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={compact ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: compact ? TOUCH_TARGET : CONTROL_HEIGHT,
          backgroundColor: disabledLook ? colors.bgSunken : palette.background,
          borderColor: disabledLook ? "transparent" : palette.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.content}>
        {loading && <ActivityIndicator size="small" color={palette.text} />}
        <Text
          variant={compact ? "label" : "bodyStrong"}
          style={{ color: disabledLook ? colors.inkSubtle : palette.text, textAlign: "center" }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
});
