import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createTransaction, rememberLastUsedAccount } from "../services/transactionsService";
import type { TransactionInput } from "../types";
import { invalidateTransactions } from "./useTransactions";

/** Lança uma despesa ou receita e guarda a conta usada, para o próximo lançamento. */
export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TransactionInput) => createTransaction(input),
    onSuccess: (transaction) => {
      rememberLastUsedAccount(transaction.account_id);
      // Sem esperar: a folha fecha na hora e a lista se atualiza logo em seguida.
      void invalidateTransactions(queryClient);
    },
  });
}
