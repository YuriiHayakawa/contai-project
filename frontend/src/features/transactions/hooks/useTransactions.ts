import { keepPreviousData, useInfiniteQuery, type QueryClient } from "@tanstack/react-query";

import { accountsQueryKey } from "../../accounts/hooks/useAccounts";
import { listTransactions } from "../services/transactionsService";
import type { TransactionFilters } from "../types";

export const transactionsQueryKey = ["transactions"] as const;

/**
 * Lista paginada de lançamentos com os filtros informados. As páginas chegam de 50 em 50;
 * `fetchNextPage` busca a seguinte. Ao trocar um filtro, a lista anterior fica na tela até a
 * nova chegar, para a página não piscar.
 */
export function useTransactions(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: [...transactionsQueryKey, "list", filters],
    queryFn: ({ pageParam, signal }) => listTransactions(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    placeholderData: keepPreviousData,
  });
}

/** Depois de criar, editar ou excluir um lançamento: as listas e os saldos das contas mudaram. */
export async function invalidateTransactions(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionsQueryKey }),
    queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
  ]);
}
