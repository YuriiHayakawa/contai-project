import { useMutation, useQueryClient } from "@tanstack/react-query";

import { uploadImport } from "../services/importsService";
import type { ImportKind } from "../types";
import { importQueryKey } from "./useImport";
import { importsQueryKey } from "./useImports";

interface UploadVariables {
  file: File;
  accountId: string;
  kind: ImportKind;
}

/** Envia um arquivo. A importação volta na fila: o andamento é acompanhado por `useImport`. */
export function useUploadImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, accountId, kind }: UploadVariables) => uploadImport(file, accountId, kind),
    onSuccess: (record) => {
      queryClient.setQueryData(importQueryKey(record.id), record);
      void queryClient.invalidateQueries({ queryKey: [...importsQueryKey, "list"] });
    },
  });
}
