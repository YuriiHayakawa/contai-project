// Chamadas HTTP de lançamentos. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type {
  EditScope,
  InstallmentsInput,
  Transaction,
  TransactionFilters,
  TransactionInput,
  TransactionList,
  TransactionPage,
  TransactionPatch,
  TransferInput,
} from "../types";

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

/** Compra parcelada no cartão: devolve as parcelas, em ordem. */
export async function createInstallments(input: InstallmentsInput): Promise<Transaction[]> {
  const { items } = await api.post<TransactionList>("/transactions/installments", input);
  return items;
}

/** Transferência entre contas próprias: devolve a linha de saída e a de entrada. */
export async function createTransfer(input: TransferInput): Promise<Transaction[]> {
  const { items } = await api.post<TransactionList>("/transactions/transfers", input);
  return items;
}

/**
 * Edita um lançamento e devolve o que mudou: uma linha, ou várias quando a edição alcança as
 * parcelas seguintes. Em transferência, valor, data e descrição mudam nos dois lados.
 */
export async function updateTransaction(
  id: string,
  input: TransactionPatch,
  scope: EditScope = "single",
): Promise<Transaction[]> {
  const body = await api.patch<Transaction | TransactionList>(`/transactions/${id}`, input, {
    params: { scope },
  });
  return "items" in body ? body.items : [body];
}

/** Exclui um lançamento; a transferência sai dos dois lados. */
export function deleteTransaction(id: string, scope: EditScope = "single"): Promise<void> {
  return api.delete(`/transactions/${id}`, { params: { scope } });
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
