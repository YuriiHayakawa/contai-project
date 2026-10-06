import { useQuery } from "@tanstack/react-query";

import { getConversation } from "../services/assistantService";

export const assistantQueryKey = ["assistant"] as const;

export function conversationQueryKey(id: string) {
  return [...assistantQueryKey, "conversation", id] as const;
}

/** Uma conversa com as mensagens. Sem `id`, o chat está vazio e nada é consultado. */
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationQueryKey(id ?? ""),
    queryFn: ({ signal }) => getConversation(id ?? "", signal),
    enabled: id !== undefined,
  });
}
