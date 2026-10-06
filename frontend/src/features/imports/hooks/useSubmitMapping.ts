import { useMutation, useQueryClient } from "@tanstack/react-query";

import { submitMapping } from "../services/importsService";
import type { ColumnMapping } from "../types";
import { importQueryKey } from "./useImport";

interface MappingVariables {
  id: string;
  mapping: ColumnMapping;
}

/** Envia o modelo de colunas. A importação volta para a fila e a consulta recomeça. */
export function useSubmitMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, mapping }: MappingVariables) => submitMapping(id, mapping),
    onSuccess: (record) => {
      queryClient.setQueryData(importQueryKey(record.id), record);
    },
  });
}
