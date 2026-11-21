import type { Account } from "@web/features/accounts/types";
import { useQuery } from "@tanstack/react-query";

import { listRecentTransactions } from "../services/transactions";
import { RECENT_LIMIT, mostUsedAccountId } from "../suggestions";
import { transactionsQueryKey } from "./useTransactions";

/** Os últimos 50 lançamentos, base das sugestões de conta e de categoria. */
export function useRecentTransactions() {
  return useQuery({
    queryKey: [...transactionsQueryKey, "recent"],
    queryFn: ({ signal }) => listRecentTransactions(RECENT_LIMIT, signal),
  });
}

/** A conta mais frequente entre os últimos 50 lançamentos, ou a primeira conta ativa. */
export function useMostUsedAccount(accounts: Account[] | undefined): string | null {
  const recent = useRecentTransactions();
  if (!accounts) return null;
  return mostUsedAccountId(recent.data ?? [], accounts);
}
