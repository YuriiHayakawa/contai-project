// Chamadas HTTP de contas. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { Account, AccountInput, AccountList } from "../types";

/** Todas as contas, com as arquivadas: os lançamentos antigos continuam mostrando o nome delas. */
export async function listAccounts(): Promise<Account[]> {
  const { items } = await api.get<AccountList>("/accounts", {
    params: { include_archived: true },
  });
  return items;
}

export function createAccount(input: AccountInput): Promise<Account> {
  return api.post<Account>("/accounts", input);
}

export function updateAccount(id: string, input: AccountInput): Promise<Account> {
  return api.patch<Account>(`/accounts/${id}`, input);
}

/** Só uma conta sem lançamentos pode ser excluída; as demais respondem `409`. */
export function deleteAccount(id: string): Promise<void> {
  return api.delete(`/accounts/${id}`);
}

export function archiveAccount(id: string): Promise<Account> {
  return api.post<Account>(`/accounts/${id}/archive`);
}

export function unarchiveAccount(id: string): Promise<Account> {
  return api.post<Account>(`/accounts/${id}/unarchive`);
}
