import { ACCOUNT_TYPE_LABELS } from "@web/features/accounts/types";
import type { AccountBalance } from "@web/features/dashboard/types";
import { StyleSheet, View } from "react-native";

import { MoneyText } from "@/components/ui/MoneyText";
import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** O saldo de hoje de cada conta ativa, como a API devolve. */
export function AccountBalances({ accounts }: { accounts: AccountBalance[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title3" accessibilityRole="header">
        Saldo das contas
      </Text>
      {accounts.map((account) => (
        <View
          key={account.id}
          accessible
          accessibilityLabel={`${account.name}: ${spokenBRL(account.balance_cents)}`}
          style={[styles.row, { borderTopColor: colors.border }]}
        >
          <View style={styles.name}>
            <Text variant="body">{account.name}</Text>
            <Text variant="small" color="inkMuted">
              {ACCOUNT_TYPE_LABELS[account.type]}
            </Text>
          </View>
          <MoneyText cents={account.balance_cents} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    borderTopWidth: 1,
    paddingTop: space[2],
  },
  name: { flexShrink: 1 },
});
