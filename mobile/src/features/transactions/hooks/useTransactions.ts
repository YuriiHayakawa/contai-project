import type { TransactionFilters } from "@web/features/transactions/types";
import { type YearMonth, monthRange } from "@web/lib/dates";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import { listTransactions } from "../services/transactions";

export const transactionsQueryKey = ["transactions"] as const;
/** O painel inteiro fica sob esta chave; um lançamento novo ou alterado a invalida. */
export const dashboardQueryKey = ["dashboard"] as const;

/** Os lançamentos de um mês, opcionalmente de uma categoria, do mais recente ao mais antigo. */
export function useTransactions(month: YearMonth, categoryId?: string | null) {
  const filters: TransactionFilters = {
    ...monthRange(month),
    ...(categoryId ? { category_id: categoryId } : {}),
  };
  const query = useInfiniteQuery({
    queryKey: [...transactionsQueryKey, "month", month, categoryId ?? null],
    queryFn: ({ pageParam, signal }) => listTransactions(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    // Ao trocar de mês, a lista anterior fica até a nova chegar, sem piscar.
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}
