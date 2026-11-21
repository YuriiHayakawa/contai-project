import type { Transaction } from "@web/features/transactions/types";
import { dayLabel } from "@web/lib/dates";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { MoneyText } from "@/components/ui/MoneyText";
import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { VoiceBadge, voicePhraseLabel } from "./VoiceBadge";
import { undoLabel } from "./VoiceHighlights";

export interface TransactionRowProps {
  transaction: Transaction;
  categoryLabel: string | null;
  accountName: string | null;
  onPress: () => void;
  /** Só nos lançamentos por voz: desfaz com um toque, sem confirmação (FR-029). */
  onUndo?: () => void;
  undoing?: boolean;
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
 * A despesa fica na tinta comum com "−"; só a receita é colorida, com "+". Um lançamento por voz
 * leva a marca "por voz", a frase entendida e o "Desfazer".
 */
export function TransactionRow({
  transaction,
  categoryLabel,
  accountName,
  onPress,
  onUndo,
  undoing = false,
}: TransactionRowProps) {
  const { colors } = useTheme();
  const cents = signedCents(transaction);
  const income = transaction.type === "income";
  const byVoice = transaction.source === "voice";
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
    byVoice ? "lançado por voz" : null,
    transaction.voice_phrase ? voicePhraseLabel(transaction.voice_phrase) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Abre o lançamento."
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: colors.bgSunken }]}
      >
        <View style={styles.text}>
          <Text variant="bodyStrong">{transaction.description}</Text>
          {byVoice && <VoiceBadge />}
          <Text variant="small" color="inkMuted">
            {meta ? `${meta} · ${day}` : day}
          </Text>
          {transaction.voice_phrase && (
            <Text variant="small" color="inkMuted">
              {voicePhraseLabel(transaction.voice_phrase)}
            </Text>
          )}
        </View>
        <MoneyText
          cents={cents}
          sign="always"
          color={income ? "income" : "ink"}
          style={styles.value}
        />
      </Pressable>
      {byVoice && onUndo && (
        <Button
          compact
          variant="ghost"
          label="Desfazer"
          accessibilityLabel={undoLabel(transaction)}
          loading={undoing}
          onPress={onUndo}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: 1, paddingBottom: space[1] },
  main: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
  },
  text: { flex: 1, gap: space[1] },
  value: { textAlign: "right" },
});
