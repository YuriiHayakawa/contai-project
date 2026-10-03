import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createInstallments, rememberLastUsedAccount } from "../services/transactionsService";
import type { InstallmentsInput } from "../types";
import { invalidateTransactions } from "./useTransactions";

/** Lança uma compra parcelada no cartão e guarda o cartão usado, para o próximo lançamento. */
export function useCreateInstallments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InstallmentsInput) => createInstallments(input),
    onSuccess: (_, input) => {
      rememberLastUsedAccount(input.account_id);
      // Sem esperar: a folha fecha na hora e a lista se atualiza logo em seguida.
      void invalidateTransactions(queryClient);
    },
  });
}
