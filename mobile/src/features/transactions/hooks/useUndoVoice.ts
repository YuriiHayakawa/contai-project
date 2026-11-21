import type { Transaction } from "@web/features/transactions/types";
import { useMutation } from "@tanstack/react-query";

import { useToast } from "@/components/ui/Toast";
import { errorMessage, isApiError } from "@/lib/api-client";

import { restoreTransaction, undoVoice } from "../services/voice";
import { useInvalidateTransactions } from "./useSaveTransaction";

export const ALREADY_UNDONE_MESSAGE = "Esse lançamento já tinha sido desfeito.";

/**
 * Desfaz um lançamento por voz com um toque, sem confirmação (FR-029). O aviso oferece "Refazer"
 * enquanto o token de restauração vale (10 s), e o VoiceOver anuncia as duas coisas.
 */
export function useUndoVoice() {
  const toast = useToast();
  const invalidate = useInvalidateTransactions();

  const restore = useMutation({
    mutationFn: (restoreToken: string) => restoreTransaction(restoreToken),
    onSuccess: async () => {
      await invalidate();
      toast.show({ message: "Lançamento refeito.", kind: "success" });
    },
    onError: (error) => toast.show({ message: errorMessage(error), kind: "error" }),
  });

  return useMutation({
    mutationFn: (transaction: Transaction) => undoVoice(transaction.id),
    onSuccess: async ({ restore_token: token, expires_in: seconds }) => {
      toast.show({
        message: "Lançamento desfeito.",
        kind: "success",
        action: { label: "Refazer", onPress: () => restore.mutate(token) },
        durationMs: seconds * 1000,
      });
      await invalidate();
    },
    onError: async (error) => {
      if (isApiError(error) && error.code === "transaction_not_found") {
        toast.show({ message: ALREADY_UNDONE_MESSAGE, kind: "info" });
        await invalidate();
        return;
      }
      toast.show({ message: errorMessage(error), kind: "error" });
    },
  });
}
