import { useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateTransactions } from "../../transactions/hooks/useTransactions";
import { undoImport } from "../services/importsService";
import { importsQueryKey } from "./useImports";

/** Desfaz uma importação: todos os lançamentos dela saem de uma vez (FR-052). */
export function useUndoImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => undoImport(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importsQueryKey });
      void invalidateTransactions(queryClient);
    },
  });
}
