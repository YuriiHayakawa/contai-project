import { useMemo, useState } from "react";

import type { ISODate } from "../../../lib/dates";
import { categoriesById } from "../../categories/hooks/useCategories";
import type { CategoryTree } from "../../categories/types";
import { reviewLineSchema, type LineKind, type ReviewLineValues } from "../schemas";
import type { BalanceCheck, ConfirmItem, ImportItem } from "../types";

/** Uma linha da revisão: a proposta do arquivo e o que o usuário decidiu sobre ela. */
export interface ReviewLine extends ReviewLineValues {
  /** A proposta como veio do servidor; as correções ficam nos outros campos. */
  item: ImportItem;
  /** Só as linhas marcadas viram lançamentos. */
  selected: boolean;
  date: ISODate;
}

/** O que dá para corrigir em uma linha. */
export type LineEdit = Partial<ReviewLineValues>;

/** Campo de uma linha marcada que falta corrigir → o que fazer. */
export type LineProblems = Partial<Record<keyof ReviewLineValues, string>>;

/** O dinheiro sai da conta da importação: despesa ou transferência enviada. */
export function leavesAccount(item: ImportItem): boolean {
  if (item.type === "transfer") return item.transfer_direction !== "in";
  return item.type === "expense";
}

/**
 * As linhas como chegam à revisão: marcadas conforme o servidor (duplicata vem desmarcada,
 * FR-049), com a categoria ou a conta sugerida. Uma entrada sugerida em categoria de despesa é
 * um estorno (FR-084).
 */
export function initialLines(items: readonly ImportItem[], categories: CategoryTree): ReviewLine[] {
  const byId = categoriesById(categories);
  return items.map((item) => {
    const suggested = item.suggested_category_id ? byId.get(item.suggested_category_id) : undefined;
    let kind: LineKind = item.type;
    if (item.type === "income" && suggested?.category.kind === "expense") kind = "refund";
    return {
      item,
      selected: item.selected_by_default,
      kind,
      amountCents: item.amount_cents,
      date: item.date,
      description: item.description,
      categoryId: item.type === "transfer" ? "" : (item.suggested_category_id ?? ""),
      counterAccountId: item.suggested_counter_account_id ?? "",
    };
  });
}

/** O que falta corrigir em uma linha para ela poder ser importada; vazio quando está pronta. */
export function lineProblems(line: ReviewLine): LineProblems {
  const result = reviewLineSchema.safeParse(line);
  if (result.success) return {};
  const problems: LineProblems = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ReviewLineValues;
    problems[field] ??= issue.message;
  }
  return problems;
}

/** A decisão de uma linha no formato de `POST /imports/{id}/confirm`. */
function toConfirmItem(line: ReviewLine): ConfirmItem {
  const isTransfer = line.kind === "transfer";
  return {
    id: line.item.id,
    selected: line.selected,
    // O estorno é uma receita lançada na categoria de despesa da compra.
    type: line.kind === "refund" ? "income" : line.kind,
    amount_cents: line.amountCents,
    date: line.date,
    description: line.description.trim(),
    category_id: isTransfer ? null : line.categoryId || null,
    counter_account_id: isTransfer ? line.counterAccountId || null : null,
  };
}

/**
 * O saldo da conta na data do saldo do banco, com as linhas marcadas agora (FR-082). Só contam
 * as linhas com data entre a data de referência da conta e a data do saldo do banco.
 */
export function reviewBalanceCents(check: BalanceCheck, lines: readonly ReviewLine[]): number {
  return lines.reduce((balance, line) => {
    if (!line.selected) return balance;
    if (line.date < check.counted_from || line.date > check.bank_balance_date) return balance;
    return balance + (leavesAccount(line.item) ? -line.amountCents : line.amountCents);
  }, check.account_balance_cents);
}

/**
 * Estado da revisão de uma importação: quais linhas estão marcadas e as correções de cada uma.
 * Nada vai ao servidor antes da confirmação; `confirmItems` monta o corpo dela, com todas as
 * linhas, cada uma uma vez.
 */
export function useImportReview(items: readonly ImportItem[], categories: CategoryTree) {
  const [lines, setLines] = useState(() => initialLines(items, categories));

  const problems = useMemo(() => {
    const found = new Map<string, LineProblems>();
    for (const line of lines) {
      if (!line.selected) continue;
      const lineIssues = lineProblems(line);
      if (Object.keys(lineIssues).length > 0) found.set(line.item.id, lineIssues);
    }
    return found;
  }, [lines]);

  const selectedCount = lines.filter((line) => line.selected).length;

  return {
    lines,
    selectedCount,
    allSelected: lines.length > 0 && selectedCount === lines.length,
    /** Linhas marcadas que ainda não podem ser importadas, com o que falta em cada uma. */
    problems,
    /** Marca ou desmarca uma linha. */
    toggle: (id: string): void => {
      setLines((current) =>
        current.map((line) => (line.item.id === id ? { ...line, selected: !line.selected } : line)),
      );
    },
    /** Marca ou desmarca todas de uma vez, inclusive as duplicatas. */
    toggleAll: (selected: boolean): void => {
      setLines((current) => current.map((line) => ({ ...line, selected })));
    },
    /** Corrige uma linha: tipo, valor, data, descrição, categoria ou a outra conta. */
    edit: (id: string, changes: LineEdit): void => {
      setLines((current) =>
        current.map((line) => (line.item.id === id ? { ...line, ...changes } : line)),
      );
    },
    /** O corpo da confirmação: todas as linhas, na ordem do arquivo. */
    confirmItems: (): ConfirmItem[] => lines.map(toConfirmItem),
  };
}

export type ImportReview = ReturnType<typeof useImportReview>;
