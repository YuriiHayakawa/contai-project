import type { Transaction } from "@web/features/transactions/types";
import { dayLabel } from "@web/lib/dates";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { MoneyText } from "@/components/ui/MoneyText";
import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { useAccounts } from "../../accounts/hooks/useAccounts";
import { categoriesById, useCategories } from "../../categories/hooks/useCategories";
import { useUndoVoice } from "../hooks/useUndoVoice";
import { useVoiceHighlights } from "../hooks/useVoiceHighlights";
import { VoiceBadge, voicePhraseLabel } from "./VoiceBadge";

/** O rótulo do "Desfazer": diz o que será desfeito, para quem usa o VoiceOver. */
export function undoLabel(transaction: Transaction): string {
  return `Lançado por voz, ${spokenBRL(transaction.amount_cents)}, ${transaction.description}. Desfazer`;
}

/**
 * "Lançados por voz", no topo do painel (US4): o que a Siri lançou nos últimos 7 dias, com a
 * frase entendida e o "Desfazer" de um toque. Sem nenhum, o bloco não aparece.
 */
export function VoiceHighlights() {
  const { colors } = useTheme();
  const highlights = useVoiceHighlights();
  const accounts = useAccounts();
  const categories = useCategories();
  const undo = useUndoVoice();

  const items = highlights.data ?? [];
  if (items.length === 0) return null;

  const accountNames = new Map((accounts.data ?? []).map((account) => [account.id, account.name]));
  const categoryLabels = categories.data ? categoriesById(categories.data) : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title3" accessibilityRole="header">
        Lançados por voz
      </Text>
      {items.map((transaction) => {
        const meta = [
          transaction.category_id ? categoryLabels?.get(transaction.category_id)?.label : null,
          accountNames.get(transaction.account_id),
          dayLabel(transaction.date),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <View key={transaction.id} style={[styles.item, { borderTopColor: colors.border }]}>
            <View style={styles.line}>
              <View style={styles.text}>
                <Text variant="bodyStrong">{transaction.description}</Text>
                <VoiceBadge />
              </View>
              <MoneyText
                cents={
                  transaction.type === "income"
                    ? transaction.amount_cents
                    : -transaction.amount_cents
                }
                sign="always"
                color={transaction.type === "income" ? "income" : "ink"}
              />
            </View>
            <Text variant="small" color="inkMuted">
              {meta}
            </Text>
            {transaction.voice_phrase && (
              <Text variant="small" color="inkMuted">
                {voicePhraseLabel(transaction.voice_phrase)}
              </Text>
            )}
            <Button
              compact
              variant="ghost"
              label="Desfazer"
              accessibilityLabel={undoLabel(transaction)}
              loading={undo.isPending && undo.variables?.id === transaction.id}
              onPress={() => undo.mutate(transaction)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  item: { borderTopWidth: 1, paddingTop: space[3], gap: space[1] },
  line: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  text: { flex: 1, gap: space[1] },
});
