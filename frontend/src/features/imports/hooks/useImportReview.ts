import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ISODate } from "../../../lib/dates";
import { categoriesById } from "../../categories/hooks/useCategories";
import type { CategoryTree } from "../../categories/types";
import { reviewLineSchema, type LineKind, type ReviewLineValues } from "../schemas";
import { selectAllImportItems, updateImportItem } from "../services/importsService";
import type { BalanceCheck, ConfirmItem, Import, ImportItem, ImportItemPatch } from "../types";
import { importQueryKey } from "./useImport";
import { importsQueryKey } from "./useImports";

/** Uma linha da revisão, como está guardada no servidor, nos termos da tela. */
export interface ReviewLine extends ReviewLineValues {
  /** A linha como o servidor a guarda: a proposta do arquivo com as correções já feitas. */
  item: ImportItem;
  /** Só as linhas marcadas viram lançamentos. */
  selected: boolean;
  date: ISODate;
}

/** O que dá para corrigir em uma linha. */
export type LineEdit = Partial<ReviewLineValues>;

/** Campo de uma linha marcada que falta corrigir → o que fazer. */
export type LineProblems = Partial<Record<keyof ReviewLineValues, string>>;

export interface ImportReviewOptions {
  /** Uma correção não foi salva: a linha volta ao que estava, e a tela avisa o usuário. */
  onSaveError?: (error: unknown) => void;
}

interface LinePatch {
  id: string;
  patch: ImportItemPatch;
}

/** O dinheiro sai da conta da importação: despesa ou transferência enviada. */
export function leavesAccount(item: ImportItem): boolean {
  if (item.type === "transfer") return item.transfer_direction !== "in";
  return item.type === "expense";
}

/**
 * As linhas da revisão como estão guardadas: na primeira vez, do jeito que foram sugeridas
 * (duplicata desmarcada, FR-049); depois, com o que o usuário já corrigiu. Uma entrada em
 * categoria de despesa é um estorno (FR-084).
 */
export function toLines(items: readonly ImportItem[], categories: CategoryTree): ReviewLine[] {
  const byId = categoriesById(categories);
  return items.map((item) => {
    const category = item.category_id ? byId.get(item.category_id) : undefined;
    let kind: LineKind = item.type;
    if (item.type === "income" && category?.category.kind === "expense") kind = "refund";
    return {
      item,
      selected: item.selected,
      kind,
      amountCents: item.amount_cents,
      date: item.date,
      description: item.description,
      notes: item.notes ?? "",
      categoryId: item.category_id ?? "",
      counterAccountId: item.counter_account_id ?? "",
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
    notes: line.notes.trim() || null,
    category_id: isTransfer ? null : line.categoryId || null,
    counter_account_id: isTransfer ? line.counterAccountId || null : null,
  };
}

/** A correção nos termos da API, só com os campos que mudaram em relação ao que está salvo. */
function toPatch(item: ImportItem, changes: LineEdit): ImportItemPatch {
  const wanted: ImportItemPatch = {};
  if (changes.kind !== undefined) wanted.type = changes.kind === "refund" ? "income" : changes.kind;
  if (changes.amountCents !== undefined) wanted.amount_cents = changes.amountCents;
  if (changes.date !== undefined) wanted.date = changes.date;
  if (changes.description !== undefined) wanted.description = changes.description.trim();
  if (changes.notes !== undefined) wanted.notes = changes.notes.trim() || null;
  if (changes.categoryId !== undefined) wanted.category_id = changes.categoryId || null;
  if (changes.counterAccountId !== undefined) {
    wanted.counter_account_id = changes.counterAccountId || null;
  }
  const saved: ImportItemPatch = item;
  return Object.fromEntries(
    Object.entries(wanted).filter(
      ([field, value]) => saved[field as keyof ImportItemPatch] !== value,
    ),
  );
}

/** A linha com a correção aplicada, como o servidor vai devolvê-la. */
function withPatch(item: ImportItem, patch: ImportItemPatch): ImportItem {
  const next = { ...item, ...patch };
  if (patch.type !== undefined) {
    // O sentido do dinheiro é o do extrato: a transferência sai da conta ou entra nela.
    const direction = leavesAccount(item) ? "out" : "in";
    next.transfer_direction = patch.type === "transfer" ? direction : null;
  }
  return next;
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
 * A revisão de uma importação. As linhas são as que o servidor guarda, e cada alteração
 * (marcar, desmarcar, corrigir) é salva na hora: a tela muda já, o servidor recebe as
 * alterações uma por vez, na ordem em que foram feitas, e a revisão pode ser retomada depois
 * de sair da página (FR-085). Nada vira lançamento antes da confirmação; `confirmItems` monta
 * o corpo dela, com todas as linhas, cada uma uma vez.
 */
export function useImportReview(
  record: Import,
  categories: CategoryTree,
  { onSaveError }: ImportReviewOptions = {},
) {
  const queryClient = useQueryClient();
  const queryKey = importQueryKey(record.id);
  const mutationKey = [...importsQueryKey, "review", record.id];
  // As alterações da mesma revisão vão ao servidor em fila: a última feita é a que fica.
  const scope = { id: mutationKey.join("/") };

  const items = record.items;
  const lines = useMemo(() => toLines(items ?? [], categories), [items, categories]);

  const changeSaved = (change: (saved: ImportItem[]) => ImportItem[]): void => {
    queryClient.setQueryData<Import>(queryKey, (current) =>
      current?.items ? { ...current, items: change(current.items) } : current,
    );
  };
  const savedItems = (): ImportItem[] => queryClient.getQueryData<Import>(queryKey)?.items ?? [];

  // Com a última alteração gravada, a tela confere com o servidor o que ficou salvo.
  const onSettled = (): void => {
    if (queryClient.isMutating({ mutationKey }) === 1) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const saveLine = useMutation({
    mutationKey,
    scope,
    mutationFn: ({ id, patch }: LinePatch) => updateImportItem(record.id, id, patch),
    onMutate: async ({ id, patch }) => {
      // Uma consulta em andamento traria a linha de antes da alteração.
      await queryClient.cancelQueries({ queryKey });
      const previous = savedItems().find((item) => item.id === id);
      changeSaved((saved) => saved.map((item) => (item.id === id ? withPatch(item, patch) : item)));
      return { previous };
    },
    onError: (error, { id }, context) => {
      const previous = context?.previous;
      if (previous) changeSaved((saved) => saved.map((item) => (item.id === id ? previous : item)));
      onSaveError?.(error);
    },
    onSettled,
  });

  const saveSelection = useMutation({
    mutationKey,
    scope,
    mutationFn: (selected: boolean) => selectAllImportItems(record.id, selected),
    onMutate: async (selected) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = new Map(savedItems().map((item) => [item.id, item.selected]));
      changeSaved((saved) => saved.map((item) => ({ ...item, selected })));
      return { previous };
    },
    onError: (error, _, context) => {
      changeSaved((saved) =>
        saved.map((item) => ({
          ...item,
          selected: context?.previous.get(item.id) ?? item.selected,
        })),
      );
      onSaveError?.(error);
    },
    onSettled,
  });

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
  const isSaving = useIsMutating({ mutationKey }) > 0;

  return {
    lines,
    selectedCount,
    allSelected: lines.length > 0 && selectedCount === lines.length,
    /** Linhas marcadas que ainda não podem ser importadas, com o que falta em cada uma. */
    problems,
    /** Há alteração a caminho do servidor. */
    isSaving,
    /** Marca ou desmarca uma linha. */
    toggle: (id: string): void => {
      const line = lines.find((candidate) => candidate.item.id === id);
      if (line) saveLine.mutate({ id, patch: { selected: !line.selected } });
    },
    /** Marca ou desmarca todas de uma vez, inclusive as duplicatas. */
    toggleAll: (selected: boolean): void => saveSelection.mutate(selected),
    /** Edita uma linha: tipo, valor, data, descrição, observação, categoria ou a outra conta. */
    edit: (id: string, changes: LineEdit): void => {
      const line = lines.find((candidate) => candidate.item.id === id);
      if (!line) return;
      const patch = toPatch(line.item, changes);
      // Salvar sem ter mudado nada não vai ao servidor.
      if (Object.keys(patch).length > 0) saveLine.mutate({ id, patch });
    },
    /** O corpo da confirmação: todas as linhas, na ordem do arquivo. */
    confirmItems: (): ConfirmItem[] => lines.map(toConfirmItem),
  };
}

export type ImportReview = ReturnType<typeof useImportReview>;
