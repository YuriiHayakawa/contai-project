import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateTransaction } from "../services/transactionsService";
import type { EditScope, TransactionPatch } from "../types";
import { invalidateTransactions } from "./useTransactions";

interface UpdateTransactionVariables {
  id: string;
  input: TransactionPatch;
  /** Só em parcelas: esta, ou esta e as seguintes. */
  scope?: EditScope;
}

/** Edita um lançamento e devolve as linhas que mudaram. */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input, scope }: UpdateTransactionVariables) =>
      updateTransaction(id, input, scope),
    onSuccess: () => invalidateTransactions(queryClient),
  });
}
