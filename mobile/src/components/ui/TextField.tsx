import { type ComponentRef, forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { CONTROL_HEIGHT, TOUCH_TARGET, radius, space, textStyles } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "accessibilityLabel"> {
  /** Rótulo sempre visível acima do campo; o placeholder nunca o substitui. */
  label: string;
  optional?: boolean;
  /** Ajuda abaixo do campo. */
  help?: string;
  /** Erro junto do campo, dizendo como corrigir. */
  error?: string;
  /** Senha: com botão de mostrar e ocultar. */
  password?: boolean;
}

/** Campo de texto (design-system, seção 6.2). */
export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(
  function TextField(
    { label, optional = false, help, error, password = false, editable = true, ...inputProps },
    ref,
  ) {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const visibleLabel = optional ? `${label} (opcional)` : label;
    const body = textStyles.body;

    return (
      <View style={styles.wrapper}>
        <Text variant="label" color="ink">
          {visibleLabel}
        </Text>
        <View
          style={[
            styles.box,
            {
              backgroundColor: editable ? colors.surface : colors.bgSunken,
              borderColor: error ? colors.danger : focused ? colors.primary : colors.borderStrong,
              borderWidth: error || focused ? 2 : 1.5,
            },
          ]}
        >
          <TextInput
            ref={ref}
            {...inputProps}
            editable={editable}
            accessibilityLabel={visibleLabel}
            // O VoiceOver lê o erro, ou a ajuda, depois do rótulo.
            accessibilityHint={error ?? help}
            secureTextEntry={password && !revealed}
            placeholderTextColor={colors.inkSubtle}
            onFocus={(event) => {
              setFocused(true);
              inputProps.onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              inputProps.onBlur?.(event);
            }}
            style={[
              styles.input,
              {
                color: editable ? colors.ink : colors.inkSubtle,
                fontFamily: fontFamily(body.role, body.weight),
                fontSize: body.fontSize,
              },
            ]}
          />
          {password && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={revealed ? "Ocultar a senha" : "Mostrar a senha"}
              onPress={() => setRevealed((value) => !value)}
              style={styles.reveal}
            >
              <Text variant="label" color="primary">
                {revealed ? "Ocultar" : "Mostrar"}
              </Text>
            </Pressable>
          )}
        </View>
        {error ? (
          <Text variant="small" color="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : help ? (
          <Text variant="small" color="inkMuted">
            {help}
          </Text>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrapper: { gap: space[2] },
  box: {
    minHeight: CONTROL_HEIGHT,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, minHeight: CONTROL_HEIGHT, paddingHorizontal: 14, paddingVertical: space[3] },
  reveal: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space[3],
    alignItems: "center",
    justifyContent: "center",
  },
});
