import type { Account } from "@web/features/accounts/types";
import type { Transaction } from "@web/features/transactions/types";
import { dayLabel } from "@web/lib/dates";
import { paths } from "@web/lib/paths";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { MoneyText } from "@/components/ui/MoneyText";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { SITE_LINK_HINT, openSite } from "@/lib/site";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** Transferências e parcelas aparecem no app, mas mudam só pelo site nesta versão (FR-011). */
export function isEditableInApp(transaction: Transaction): boolean {
  return transaction.type !== "transfer" && transaction.installment_group_id === null;
}

export interface ReadOnlyTransactionProps {
  transaction: Transaction;
  accounts: Account[];
  categoryLabel: string | null;
}

export function ReadOnlyTransaction({
  transaction,
  accounts,
  categoryLabel,
}: ReadOnlyTransactionProps) {
  const { colors } = useTheme();
  const account = accounts.find((item) => item.id === transaction.account_id);
  const kind =
    transaction.type === "transfer"
      ? transaction.transfer_direction === "out"
        ? "Transferência enviada"
        : "Transferência recebida"
      : `Parcela ${transaction.installment_number ?? "?"} de ${transaction.installment_count ?? "?"}`;
  const signed =
    transaction.type === "income" || transaction.transfer_direction === "in"
      ? transaction.amount_cents
      : -transaction.amount_cents;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="label" color="inkMuted">
          {kind}
        </Text>
        <Text variant="title3">{transaction.description}</Text>
        <MoneyText cents={signed} variant="moneyLg" />
        <Text variant="small" color="inkMuted">
          {[categoryLabel, account?.name, dayLabel(transaction.date)].filter(Boolean).join(" · ")}
        </Text>
        {transaction.notes ? <Text variant="body">{transaction.notes}</Text> : null}
      </View>
      <Notice kind="info">
        Transferências e compras parceladas são alteradas pelo site, para as duas pontas e todas as
        parcelas mudarem juntas.
      </Notice>
      <Button
        variant="secondary"
        label="Alterar pelo site"
        accessibilityHint={SITE_LINK_HINT}
        onPress={() => void openSite(paths.transactions)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[4] },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[2] },
});
