import { useInfiniteQuery } from "@tanstack/react-query";

import { listImports } from "../services/importsService";
import { isWorking } from "../types";

export const importsQueryKey = ["imports"] as const;

/** Intervalo da consulta enquanto um arquivo está na fila ou sendo lido. */
export const IMPORT_POLL_INTERVAL_MS = 2000;

/**
 * Histórico de importações, da mais nova para a mais antiga (FR-051). Enquanto alguma ainda
 * está sendo lida, a lista se atualiza sozinha.
 */
export function useImports() {
  return useInfiniteQuery({
    queryKey: [...importsQueryKey, "list"],
    queryFn: ({ pageParam, signal }) => listImports(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((item) => isWorking(item.status)))
        ? IMPORT_POLL_INTERVAL_MS
        : false,
  });
}
