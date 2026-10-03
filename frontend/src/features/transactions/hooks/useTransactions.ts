import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";

import { accountsQueryKey } from "../../accounts/hooks/useAccounts";
import { dashboardQueryKey } from "../../dashboard/query-key";
import { countTransactions, listTransactions } from "../services/transactionsService";
import type { Transaction, TransactionFilters } from "../types";

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

/**
 * Lançamentos ligados a este: as parcelas da mesma compra ou os dois lados da mesma
 * transferência. Lista vazia para uma despesa ou receita avulsa.
 */
export function useRelatedTransactions(transaction: Transaction | undefined) {
  let filters: TransactionFilters | null = null;
  if (transaction?.installment_group_id) {
    filters = { installment_group_id: transaction.installment_group_id };
  } else if (transaction?.transfer_group_id) {
    filters = { transfer_group_id: transaction.transfer_group_id };
  }
  return useQuery({
    queryKey: [...transactionsQueryKey, "related", filters],
    queryFn: async ({ signal }) =>
      filters ? (await listTransactions(filters, null, signal)).items : [],
    enabled: filters !== null,
  });
}

/** Quantos lançamentos o usuário tem ao todo: zero é o sinal de quem ainda está começando. */
export function useTransactionCount() {
  return useQuery({
    queryKey: [...transactionsQueryKey, "count"],
    queryFn: ({ signal }) => countTransactions(signal),
  });
}

/**
 * Depois de criar, editar ou excluir um lançamento: as listas, os saldos das contas e os
 * números do painel mudaram.
 */
export async function invalidateTransactions(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionsQueryKey }),
    queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
    queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
  ]);
}
