import { useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateTransactions } from "../../transactions/hooks/useTransactions";
import { confirmImport } from "../services/importsService";
import type { ConfirmItem } from "../types";
import { importsQueryKey } from "./useImports";

interface ConfirmVariables {
  id: string;
  items: ConfirmItem[];
}

/** Confirma a revisão: as linhas marcadas viram lançamentos, todas de uma vez (FR-046). */
export function useConfirmImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, items }: ConfirmVariables) => confirmImport(id, items),
    onSuccess: () => {
      // Os lançamentos, os saldos e o painel mudaram junto com o histórico.
      void queryClient.invalidateQueries({ queryKey: importsQueryKey });
      void invalidateTransactions(queryClient);
    },
  });
}
