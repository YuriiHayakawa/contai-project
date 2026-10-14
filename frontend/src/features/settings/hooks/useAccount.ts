import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sessionQueryKey } from "../../auth/hooks/useAuth";
import { cancelDeletion, exportData, requestDeletion } from "../services/settingsService";
import type { AccountDeletion, AccountDeletionInput } from "../types";

/** Baixa o ZIP com todos os dados da conta. A gravação do arquivo fica a cargo de quem chama. */
export function useExportData() {
  return useMutation<Blob>({ mutationFn: () => exportData() });
}

/** Pede a exclusão. O servidor encerra todas as sessões; quem chama precisa sair em seguida. */
export function useRequestDeletion() {
  return useMutation<AccountDeletion, Error, AccountDeletionInput>({
    mutationFn: (input) => requestDeletion(input),
  });
}

/** Cancela a exclusão e recarrega a sessão, já com a conta ativa de novo. */
export function useCancelDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cancelDeletion(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });
}
