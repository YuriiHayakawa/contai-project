import { centsFromTypedText, formatCentsAsDecimal } from "@web/lib/money";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { spokenBRL } from "@/lib/spoken-money";
import { fontFamily } from "@/theme/fonts";
import { space, textStyles } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export interface MoneyInputProps {
  /** Valor em centavos inteiros; nunca negativo. */
  value: number;
  onChange: (cents: number) => void;
  error?: string;
  help?: string;
  /** Com "Receita", o valor fica na cor de receita. */
  income?: boolean;
  testID?: string;
}

/**
 * Campo de dinheiro (design-system, seção 6.3), com digitação de caixa registradora: os
 * algarismos entram pela direita. Digitar 4, 5, 9 e 0 mostra 0,04, 0,45, 4,59 e 45,90.
 */
export function MoneyInput({
  value,
  onChange,
  error,
  help,
  income = false,
  testID,
}: MoneyInputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const hero = textStyles.moneyHero;
  const textColor = income ? colors.income : colors.ink;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.line,
          {
            borderBottomColor: error
              ? colors.danger
              : focused
                ? colors.primary
                : colors.borderStrong,
          },
        ]}
      >
        <Text
          variant="title2"
          style={{ color: textColor }}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          R$
        </Text>
        <TextInput
          testID={testID}
          value={formatCentsAsDecimal(value)}
          onChangeText={(text) => onChange(centsFromTypedText(text, value))}
          keyboardType="number-pad"
          accessibilityLabel="Valor em reais"
          accessibilityValue={{ text: spokenBRL(value) }}
          accessibilityHint={error ?? help}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.input,
            {
              color: textColor,
              fontFamily: fontFamily(hero.role, hero.weight),
              fontSize: hero.fontSize,
              fontVariant: ["tabular-nums", "lining-nums"],
            },
          ]}
        />
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
}

const styles = StyleSheet.create({
  wrapper: { gap: space[2] },
  line: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
    borderBottomWidth: 2,
    paddingBottom: space[1],
  },
  input: { flex: 1, minHeight: 56, paddingVertical: 0 },
});
