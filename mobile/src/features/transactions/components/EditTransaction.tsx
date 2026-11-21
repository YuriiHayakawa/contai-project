import type { Account } from "@web/features/accounts/types";
import type { CategoryTree } from "@web/features/categories/types";
import type { Transaction } from "@web/features/transactions/types";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { errorMessage } from "@/lib/api-client";
import { space } from "@/theme/tokens";

import { categoriesById } from "../../categories/hooks/useCategories";
import { useDeleteTransaction } from "../hooks/useDeleteTransaction";
import { useUndoVoice } from "../hooks/useUndoVoice";
import { useSaveTransaction } from "../hooks/useSaveTransaction";
import { ReadOnlyTransaction, isEditableInApp } from "./ReadOnlyTransaction";
import { TransactionForm } from "./TransactionForm";
import { VoiceBadge, voicePhraseLabel } from "./VoiceBadge";
import { undoLabel } from "./VoiceHighlights";

export interface EditTransactionProps {
  transaction: Transaction;
  accounts: Account[];
  categories: CategoryTree;
  recent: Transaction[];
  /** O lançamento foi salvo, excluído ou desfeito: a tela volta para a lista. */
  onDone: (result: "saved" | "deleted" | "undone") => void;
}

/** Editar uma despesa ou receita, ou excluí-la com confirmação (FR-010). */
export function EditTransaction({
  transaction,
  accounts,
  categories,
  recent,
  onDone,
}: EditTransactionProps) {
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const undo = useUndoVoice();
  const [confirming, setConfirming] = useState(false);

  if (!isEditableInApp(transaction)) {
    const label = transaction.category_id
      ? (categoriesById(categories).get(transaction.category_id)?.label ?? null)
      : null;
    return (
      <ReadOnlyTransaction transaction={transaction} accounts={accounts} categoryLabel={label} />
    );
  }

  const byVoice = transaction.source === "voice";

  return (
    <View style={styles.wrapper}>
      {byVoice && (
        <View style={styles.voice}>
          <VoiceBadge />
          {transaction.voice_phrase && (
            <Text variant="body" color="inkMuted">
              {voicePhraseLabel(transaction.voice_phrase)}
            </Text>
          )}
          <Button
            variant="secondary"
            label="Desfazer"
            accessibilityLabel={undoLabel(transaction)}
            accessibilityHint="Apaga o lançamento na hora. Por 10 segundos, dá para refazer."
            loading={undo.isPending}
            onPress={() => undo.mutate(transaction, { onSuccess: () => onDone("undone") })}
          />
        </View>
      )}
      <TransactionForm
        accounts={accounts}
        categories={categories}
        recent={recent}
        transaction={transaction}
        submitLabel="Salvar alterações"
        saving={save.isPending}
        saveError={save.error}
        onSubmit={(input) =>
          save.mutate({ id: transaction.id, input }, { onSuccess: () => onDone("saved") })
        }
      />
      {remove.isError && <Notice kind="error">{errorMessage(remove.error)}</Notice>}
      <Button label="Excluir lançamento" variant="ghost" onPress={() => setConfirming(true)} />
      <ConfirmDialog
        open={confirming}
        title="Excluir este lançamento?"
        description="Ele sai da lista do mês, do painel e do saldo da conta, no app e no site."
        confirmLabel="Excluir"
        loading={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(transaction.id, {
            onSuccess: () => {
              setConfirming(false);
              onDone("deleted");
            },
            onError: () => setConfirming(false),
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[4] },
  voice: { gap: space[2] },
});
