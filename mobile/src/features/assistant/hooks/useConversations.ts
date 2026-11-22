import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteConversation, getUsage, listConversations } from "../services/assistant";

export const assistantQueryKey = ["assistant"] as const;
export const conversationsQueryKey = [...assistantQueryKey, "conversations"] as const;
export const usageQueryKey = [...assistantQueryKey, "usage"] as const;

/** O histórico, compartilhado com o site, da conversa mais recente para a mais antiga. */
export function useConversations() {
  const query = useInfiniteQuery({
    queryKey: conversationsQueryKey,
    queryFn: ({ pageParam, signal }) => listConversations(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  return { ...query, items: query.data?.pages.flatMap((page) => page.items) ?? [] };
}

/** Perguntas feitas hoje e quando o limite zera (FR-071). */
export function useAssistantUsage() {
  return useQuery({ queryKey: usageQueryKey, queryFn: ({ signal }) => getUsage(signal) });
}

/** Apaga uma conversa. Quem chama pede a confirmação antes. */
export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: async (_, id) => {
      queryClient.removeQueries({ queryKey: [...assistantQueryKey, "conversation", id] });
      await queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
  });
}
