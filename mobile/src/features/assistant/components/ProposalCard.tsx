import { dayLabel } from "@web/lib/dates";
import { formatBRL } from "@web/lib/money";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { MoneyText } from "@/components/ui/MoneyText";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { errorMessage } from "@/lib/api-client";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { useAccounts } from "../../accounts/hooks/useAccounts";
import { categoriesById, useCategories } from "../../categories/hooks/useCategories";
import { useProposalActions } from "../hooks/useProposalActions";
import type { Proposal } from "../types";

const TYPE_LABELS: Record<Proposal["type"], string> = { expense: "Despesa", income: "Receita" };
const TO_CHOOSE = "você escolhe ao ajustar";

export interface ProposalCardProps {
  messageId: string;
  proposal: Proposal;
}

/**
 * O lançamento que o assistente entendeu de uma frase. Com conta e categoria, "Salvar" grava
 * como está; "Ajustar" abre o formulário preenchido; "Descartar" não grava nada. Nada é salvo
 * antes de um desses toques, como no site.
 */
export function ProposalCard({ messageId, proposal }: ProposalCardProps) {
  const { colors } = useTheme();
  const accounts = useAccounts();
  const categories = useCategories();
  const actions = useProposalActions(messageId);
  // O lançamento acabou de ser gravado: o cartão já mostra "salvo" antes da conversa recarregar.
  const [savedHere, setSavedHere] = useState(false);

  const signed = proposal.type === "income" ? proposal.amount_cents : -proposal.amount_cents;

  if (proposal.status === "discarded") {
    return (
      <Text variant="small" color="inkMuted">
        {`Proposta descartada: ${proposal.description}, ${formatBRL(signed, { sign: "always" })}. Nada foi salvo.`}
      </Text>
    );
  }

  const saved = proposal.status === "saved" || savedHere;
  const account = accounts.data?.find((item) => item.id === proposal.account_id);
  const category = categories.data
    ? categoriesById(categories.data).get(proposal.category_id ?? "")
    : undefined;
  // Uma conta ou categoria arquivada depois da proposta já não serve a um lançamento novo.
  const usableAccount = account && !account.archived ? account : undefined;
  const usableCategory = category && !category.category.archived ? category : undefined;
  const complete = usableAccount && usableCategory;
  const missing = saved ? "—" : TO_CHOOSE;
  const loading = accounts.isPending || categories.isPending;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel={saved ? "Lançamento salvo" : "Lançamento sugerido"}
    >
      <Text variant="label" color="inkMuted">
        {TYPE_LABELS[proposal.type]}
      </Text>
      <MoneyText
        cents={signed}
        sign="always"
        variant="moneyLg"
        color={proposal.type === "income" ? "income" : "ink"}
      />
      <Text variant="bodyStrong">{proposal.description}</Text>
      <Text variant="small">{`Data: ${dayLabel(proposal.date)}`}</Text>
      {!loading && (
        <>
          <Text variant="small">{`Conta: ${account?.name ?? missing}`}</Text>
          <Text variant="small">{`Categoria: ${category?.label ?? missing}`}</Text>
        </>
      )}

      {saved ? (
        <Text variant="label" color="income">
          Lançamento salvo
        </Text>
      ) : (
        <View style={styles.actions}>
          {actions.saveError != null && (
            <Notice kind="error">{errorMessage(actions.saveError)}</Notice>
          )}
          {complete && (
            <Button
              label="Salvar lançamento"
              loading={actions.saving}
              onPress={() =>
                actions.save(
                  proposal,
                  { accountId: usableAccount.id, categoryId: usableCategory.category.id },
                  () => setSavedHere(true),
                )
              }
            />
          )}
          <Button
            variant="secondary"
            label="Ajustar"
            accessibilityHint="Abre o formulário preenchido, para conferir antes de salvar."
            onPress={() =>
              actions.adjust(proposal, {
                accountId: usableAccount?.id ?? null,
                categoryId: usableCategory?.category.id ?? null,
              })
            }
          />
          <Button
            variant="ghost"
            label="Descartar"
            loading={actions.discard.isPending}
            onPress={() => actions.discard.mutate()}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  actions: { gap: space[2], marginTop: space[2] },
});
