import { type FormatBRLOptions, formatBRL } from "@web/lib/money";

import { spokenBRL } from "@/lib/spoken-money";

import { Text, type TextProps } from "./Text";

export interface MoneyTextProps extends Omit<TextProps, "children" | "variant"> {
  cents: number;
  variant?: "moneyHero" | "moneyLg" | "moneyMd" | "moneySm";
  sign?: FormatBRLOptions["sign"];
}

/**
 * Valor em reais com algarismos tabulares, no formato do site (`formatBRL`). O VoiceOver lê o
 * valor por extenso: "45 reais e 90 centavos".
 */
export function MoneyText({
  cents,
  variant = "moneyMd",
  sign,
  accessibilityLabel,
  ...props
}: MoneyTextProps) {
  return (
    <Text
      {...props}
      variant={variant}
      // O espaço depois do "R$" é não separável: o valor não quebra, e nada corta o número
      // quando a fonte do sistema está grande.
      accessibilityLabel={accessibilityLabel ?? spokenBRL(cents)}
    >
      {formatBRL(cents, { sign })}
    </Text>
  );
}
