import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createTransfer } from "../services/transactionsService";
import type { TransferInput } from "../types";
import { invalidateTransactions } from "./useTransactions";

/** Transfere entre duas contas próprias: os dois saldos mudam, e o painel não. */
export function useCreateTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TransferInput) => createTransfer(input),
    onSuccess: () => {
      // Sem esperar: a folha fecha na hora e a lista se atualiza logo em seguida.
      void invalidateTransactions(queryClient);
    },
  });
}
