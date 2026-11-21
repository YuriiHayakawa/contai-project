import { useMutation } from "@tanstack/react-query";

import { deleteTransaction } from "../services/transactions";
import { useInvalidateTransactions } from "./useSaveTransaction";

/** Exclui um lançamento. Quem chama pede a confirmação antes. */
export function useDeleteTransaction() {
  const invalidate = useInvalidateTransactions();
  return useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: invalidate,
  });
}
