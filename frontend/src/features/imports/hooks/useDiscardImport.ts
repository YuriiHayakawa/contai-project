import { useMutation, useQueryClient } from "@tanstack/react-query";

import { discardImport } from "../services/importsService";
import { importQueryKey } from "./useImport";
import { importsQueryKey } from "./useImports";

/** Descarta uma importação que ainda não foi confirmada; nada dela fica guardado. */
export function useDiscardImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => discardImport(id),
    onSuccess: (_, id) => {
      // A importação deixou de existir: consultá-la de novo daria "não encontrada".
      queryClient.removeQueries({ queryKey: importQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: [...importsQueryKey, "list"] });
    },
  });
}
