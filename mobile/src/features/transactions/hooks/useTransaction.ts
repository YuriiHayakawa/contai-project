import { useQuery } from "@tanstack/react-query";

import { getTransaction } from "../services/transactions";
import { transactionsQueryKey } from "./useTransactions";

/** Um lançamento, para a tela de detalhe e edição. */
export function useTransaction(id: string) {
  return useQuery({
    queryKey: [...transactionsQueryKey, "detail", id],
    queryFn: ({ signal }) => getTransaction(id, signal),
  });
}
