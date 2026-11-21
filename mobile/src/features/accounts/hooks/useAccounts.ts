import type { Account } from "@web/features/accounts/types";
import { useQuery } from "@tanstack/react-query";

import { listAccounts } from "../services/accounts";

export const accountsQueryKey = ["accounts"] as const;

/** As contas do usuário, só para leitura: o cadastro fica no site. */
export function useAccounts() {
  return useQuery({ queryKey: accountsQueryKey, queryFn: ({ signal }) => listAccounts(signal) });
}

/** As contas que recebem lançamentos novos. */
export function activeAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => !account.archived);
}
