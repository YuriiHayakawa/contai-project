import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  deleteAllConversations,
  deleteConversation,
  listConversations,
} from "../services/assistantService";
import { assistantQueryKey, conversationQueryKey } from "./useConversation";

export const conversationsQueryKey = [...assistantQueryKey, "conversations"] as const;

/** Histórico de conversas (FR-069), da que teve atividade mais recente para a mais antiga. */
export function useConversations(enabled = true) {
  return useInfiniteQuery({
    queryKey: conversationsQueryKey,
    queryFn: ({ pageParam, signal }) => listConversations(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled,
  });
}

/** Apaga uma conversa, com as mensagens dela. */
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_, id) => {
      // A conversa deixou de existir: consultá-la de novo daria "não encontrada".
      queryClient.removeQueries({ queryKey: conversationQueryKey(id) });
      return queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
  });
}

/** Apaga todo o histórico de conversas. */
export function useDeleteAllConversations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteAllConversations(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [...assistantQueryKey, "conversation"] });
      return queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
  });
}
