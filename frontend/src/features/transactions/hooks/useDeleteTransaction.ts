import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteTransaction } from "../services/transactionsService";
import { invalidateTransactions } from "./useTransactions";

/** Exclui um lançamento; a lista e o saldo da conta são atualizados em seguida. */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: () => invalidateTransactions(queryClient),
  });
}
