import type { Account, AccountList } from "@web/features/accounts/types";

import { api } from "@/lib/api-client";

/** Todas as contas, com as arquivadas: os lançamentos antigos continuam mostrando o nome delas. */
export async function listAccounts(signal?: AbortSignal): Promise<Account[]> {
  const { items } = await api.get<AccountList>("/accounts", {
    params: { include_archived: true },
    signal,
  });
  return items;
}
