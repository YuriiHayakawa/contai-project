import type { Transaction } from "@web/features/transactions/types";
import { dayLabel } from "@web/lib/dates";
import { Pressable, StyleSheet, View } from "react-native";

import { MoneyText } from "@/components/ui/MoneyText";
import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

export interface TransactionRowProps {
  transaction: Transaction;
  categoryLabel: string | null;
  accountName: string | null;
  onPress: () => void;
}

function signedCents(transaction: Transaction): number {
  if (transaction.type === "income") return transaction.amount_cents;
  if (transaction.type === "transfer" && transaction.transfer_direction === "in") {
    return transaction.amount_cents;
  }
  return -transaction.amount_cents;
}

const KIND_SPOKEN = { expense: "despesa", income: "receita", transfer: "transferência" } as const;

/**
 * Uma linha da lista (design-system, seção 6.6): descrição, categoria e conta, dia e valor.
 * A despesa fica na tinta comum com "−"; só a receita é colorida, com "+".
 */
export function TransactionRow({
  transaction,
  categoryLabel,
  accountName,
  onPress,
}: TransactionRowProps) {
  const { colors } = useTheme();
  const cents = signedCents(transaction);
  const income = transaction.type === "income";
  const category = transaction.type === "transfer" ? "Transferência" : categoryLabel;
  const installment =
    transaction.installment_number && transaction.installment_count
      ? `parcela ${transaction.installment_number} de ${transaction.installment_count}`
      : null;
  const meta = [category, accountName, installment].filter(Boolean).join(" · ");
  const day = dayLabel(transaction.date);
  const spoken = [
    transaction.description,
    meta,
    day,
    `${KIND_SPOKEN[transaction.type]} de ${spokenBRL(transaction.amount_cents)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Abre o lançamento."
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.bgSunken },
      ]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong">{transaction.description}</Text>
        <Text variant="small" color="inkMuted">
          {meta ? `${meta} · ${day}` : day}
        </Text>
      </View>
      <MoneyText
        cents={cents}
        sign="always"
        color={income ? "income" : "ink"}
        style={styles.value}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
  },
  text: { flex: 1, gap: space[1] },
  value: { textAlign: "right" },
});
