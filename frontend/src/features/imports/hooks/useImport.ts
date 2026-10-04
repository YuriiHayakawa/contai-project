import { useQuery } from "@tanstack/react-query";

import { getImport } from "../services/importsService";
import { isWorking } from "../types";
import { IMPORT_POLL_INTERVAL_MS, importsQueryKey } from "./useImports";

export const importQueryKey = (id: string) => [...importsQueryKey, "detail", id] as const;

/**
 * Uma importação. Enquanto ela está na fila ou sendo lida, a consulta se repete a cada 2
 * segundos; quando passa a esperar o usuário, ou termina, a consulta para (FR-045).
 */
export function useImport(id: string | undefined) {
  return useQuery({
    queryKey: importQueryKey(id ?? ""),
    queryFn: ({ signal }) => getImport(id ?? "", signal),
    enabled: id !== undefined,
    refetchInterval: (query) =>
      query.state.data && isWorking(query.state.data.status) ? IMPORT_POLL_INTERVAL_MS : false,
  });
}
