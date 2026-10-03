import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteTransaction } from "../services/transactionsService";
import type { EditScope } from "../types";
import { invalidateTransactions } from "./useTransactions";

interface DeleteTransactionVariables {
  id: string;
  /** Só em parcelas: esta, ou esta e as seguintes. */
  scope?: EditScope;
}

/** Exclui um lançamento; a lista e o saldo da conta são atualizados em seguida. */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, scope }: DeleteTransactionVariables) => deleteTransaction(id, scope),
    onSuccess: () => invalidateTransactions(queryClient),
  });
}
