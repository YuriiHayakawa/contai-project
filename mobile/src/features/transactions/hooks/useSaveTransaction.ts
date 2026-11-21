import type { TransactionInput } from "@web/features/transactions/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createTransaction, updateTransaction } from "../services/transactions";
import { dashboardQueryKey, transactionsQueryKey } from "./useTransactions";

export interface SaveTransactionVariables {
  /** Sem `id`, cria; com ele, edita. */
  id?: string;
  input: TransactionInput;
}

/** Atualiza a lista e o painel depois de qualquer mudança num lançamento. */
export function useInvalidateTransactions(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: transactionsQueryKey });
    await queryClient.invalidateQueries({ queryKey: dashboardQueryKey });
  };
}

/** Cria ou edita uma despesa ou receita. */
export function useSaveTransaction() {
  const invalidate = useInvalidateTransactions();
  return useMutation({
    mutationFn: ({ id, input }: SaveTransactionVariables) =>
      id ? updateTransaction(id, input) : createTransaction(input),
    onSuccess: invalidate,
  });
}
