import type { PeriodTotals } from "@web/features/dashboard/types";
import { formatBRL } from "@web/lib/money";
import { StyleSheet, View } from "react-native";

import { MoneyText } from "@/components/ui/MoneyText";
import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { REFUNDS_IN_FAVOR } from "./CategoryBars";

/** Entradas, saídas e saldo do mês, prontos da API (FR-007). */
export function MonthSummary({ totals }: { totals: PeriodTotals }) {
  const { colors } = useTheme();
  const spendingInFavor = totals.expense_cents < 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View accessible accessibilityLabel={`Saldo do mês: ${spokenBRL(totals.net_cents)}`}>
        <Text variant="label" color="inkMuted">
          Saldo do mês
        </Text>
        <MoneyText cents={totals.net_cents} variant="moneyLg" />
      </View>
      <View style={styles.row}>
        <View
          style={styles.cell}
          accessible
          accessibilityLabel={`Entradas: ${spokenBRL(totals.income_cents)}`}
        >
          <Text variant="label" color="inkMuted">
            Entradas
          </Text>
          <MoneyText cents={totals.income_cents} color="income" />
        </View>
        <View
          style={styles.cell}
          accessible
          accessibilityLabel={
            spendingInFavor
              ? `Saídas: ${spokenBRL(-totals.expense_cents)} ${REFUNDS_IN_FAVOR}`
              : `Saídas: ${spokenBRL(totals.expense_cents)}`
          }
        >
          <Text variant="label" color="inkMuted">
            Saídas
          </Text>
          {spendingInFavor ? (
            <Text variant="moneyMd">{`${formatBRL(-totals.expense_cents)} ${REFUNDS_IN_FAVOR}`}</Text>
          ) : (
            <MoneyText cents={totals.expense_cents} color="expense" />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[4] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[6] },
  cell: { gap: space[1], minWidth: 120 },
});
