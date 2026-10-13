import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { endOtherSessions, endSession, listSessions } from "../services/settingsService";

export const sessionsQueryKey = ["settings", "sessions"] as const;

/** Dispositivos conectados, do mais recente para o mais antigo (FR-014). */
export function useSessions() {
  return useQuery({ queryKey: sessionsQueryKey, queryFn: listSessions });
}

function useRefreshSessions(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
}

/** Encerra uma sessão específica. */
export function useEndSession() {
  const refresh = useRefreshSessions();
  return useMutation({ mutationFn: (id: string) => endSession(id), onSuccess: refresh });
}

/** Encerra todas as outras sessões, menos a atual. */
export function useEndOtherSessions() {
  const refresh = useRefreshSessions();
  return useMutation({ mutationFn: () => endOtherSessions(), onSuccess: refresh });
}
