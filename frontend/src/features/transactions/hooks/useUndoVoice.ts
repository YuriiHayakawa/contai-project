import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../../components/ui/Toast";
import { errorMessage, isApiError } from "../../../lib/api-client";
import { restoreTransaction, undoVoice } from "../services/transactionsService";
import type { Transaction } from "../types";
import { invalidateTransactions } from "./useTransactions";

export const ALREADY_UNDONE_MESSAGE = "Esse lançamento já tinha sido desfeito.";

/**
 * Desfaz um lançamento por voz com um toque, sem confirmação (FR-029): o aviso oferece
 * "Refazer" enquanto o token de restauração vale, e o lançamento volta igual.
 */
export function useUndoVoice() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const restore = useMutation({
    mutationFn: (restoreToken: string) => restoreTransaction(restoreToken),
    onSuccess: () => {
      void invalidateTransactions(queryClient);
      toast.success("Lançamento refeito.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return useMutation({
    mutationFn: (transaction: Transaction) => undoVoice(transaction.id),
    onSuccess: ({ restore_token: token, expires_in: seconds }) => {
      void invalidateTransactions(queryClient);
      toast.success("Lançamento desfeito.", {
        action: { label: "Refazer", onClick: () => restore.mutate(token) },
        durationMs: seconds * 1000,
      });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === "transaction_not_found") {
        void invalidateTransactions(queryClient);
        toast.info(ALREADY_UNDONE_MESSAGE);
        return;
      }
      toast.error(errorMessage(error));
    },
  });
}
