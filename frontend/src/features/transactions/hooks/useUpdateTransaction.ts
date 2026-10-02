import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateTransaction } from "../services/transactionsService";
import type { TransactionInput } from "../types";
import { invalidateTransactions } from "./useTransactions";

interface UpdateTransactionVariables {
  id: string;
  input: TransactionInput;
}

/** Edita uma despesa ou receita. */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: UpdateTransactionVariables) => updateTransaction(id, input),
    onSuccess: () => invalidateTransactions(queryClient),
  });
}
