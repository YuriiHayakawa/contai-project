// Chamadas HTTP de lançamentos. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { Transaction, TransactionFilters, TransactionInput, TransactionPage } from "../types";

/** Uma página de lançamentos, da data mais nova para a mais antiga. */
export function listTransactions(
  filters: TransactionFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<TransactionPage> {
  return api.get<TransactionPage>("/transactions", { params: { ...filters, cursor }, signal });
}

/** Quantos lançamentos o usuário tem ao todo, em qualquer data. */
export async function countTransactions(signal?: AbortSignal): Promise<number> {
  const page = await api.get<TransactionPage>("/transactions", { params: { limit: 1 }, signal });
  return page.total_count;
}

export function createTransaction(input: TransactionInput): Promise<Transaction> {
  return api.post<Transaction>("/transactions", input);
}

export function updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
  return api.patch<Transaction>(`/transactions/${id}`, input);
}

export function deleteTransaction(id: string): Promise<void> {
  return api.delete(`/transactions/${id}`);
}

// ---------- última conta usada

// Fica só neste aparelho: é uma conveniência do formulário, e não um dado da conta do usuário.
const LAST_ACCOUNT_STORAGE_KEY = "contai-last-account";

/** Conta do último lançamento feito neste aparelho, para o formulário já vir com ela (FR-028). */
export function getLastUsedAccountId(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberLastUsedAccount(accountId: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, accountId);
  } catch {
    // Sem armazenamento, o formulário só volta a sugerir a primeira conta da lista.
  }
}
