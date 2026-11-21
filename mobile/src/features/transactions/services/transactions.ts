// Chamadas de lançamentos, pelos endpoints que o site já usa. Só os hooks desta feature chamam
// este módulo. Transferências e parcelas são só lidas aqui: mudam pelo site (FR-011).
import type {
  Transaction,
  TransactionFilters,
  TransactionInput,
  TransactionPage,
  TransactionPatch,
} from "@web/features/transactions/types";

import { api } from "@/lib/api-client";

/** Lançamentos por página, o maior que a API aceita: um mês cabe, em geral, numa página só. */
export const PAGE_SIZE = 200;

/** Uma página de lançamentos, da data mais nova para a mais antiga. */
export function listTransactions(
  filters: TransactionFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<TransactionPage> {
  return api.get<TransactionPage>("/transactions", {
    params: { ...filters, cursor, limit: PAGE_SIZE },
    signal,
  });
}

/** Os últimos lançamentos, base das sugestões do formulário. */
export async function listRecentTransactions(
  limit: number,
  signal?: AbortSignal,
): Promise<Transaction[]> {
  const page = await api.get<TransactionPage>("/transactions", { params: { limit }, signal });
  return page.items;
}

export function getTransaction(id: string, signal?: AbortSignal): Promise<Transaction> {
  return api.get<Transaction>(`/transactions/${id}`, { signal });
}

export function createTransaction(input: TransactionInput): Promise<Transaction> {
  return api.post<Transaction>("/transactions", input);
}

/** Edita uma despesa ou receita. Transferências e parcelas não passam por aqui. */
export function updateTransaction(id: string, input: TransactionPatch): Promise<Transaction> {
  return api.patch<Transaction>(`/transactions/${id}`, input);
}

export function deleteTransaction(id: string): Promise<void> {
  return api.delete<void>(`/transactions/${id}`);
}
