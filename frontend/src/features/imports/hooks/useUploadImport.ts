import { useMutation, useQueryClient } from "@tanstack/react-query";

import { uploadImport } from "../services/importsService";
import { importQueryKey } from "./useImport";
import { importsQueryKey } from "./useImports";

interface UploadVariables {
  file: File;
  accountId: string;
}

/** Envia um arquivo. A importação volta na fila: o andamento é acompanhado por `useImport`. */
export function useUploadImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, accountId }: UploadVariables) => uploadImport(file, accountId),
    onSuccess: (record) => {
      queryClient.setQueryData(importQueryKey(record.id), record);
      void queryClient.invalidateQueries({ queryKey: [...importsQueryKey, "list"] });
    },
  });
}
