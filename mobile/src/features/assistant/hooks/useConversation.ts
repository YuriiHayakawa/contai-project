import { useQuery } from "@tanstack/react-query";

import { getConversation } from "../services/assistant";
import { assistantQueryKey } from "./useConversations";

export function conversationQueryKey(id: string) {
  return [...assistantQueryKey, "conversation", id] as const;
}

/** Uma conversa com as mensagens, da mais antiga para a mais nova. Sem id, uma conversa nova. */
export function useConversation(id: string | null) {
  return useQuery({
    queryKey: conversationQueryKey(id ?? "nova"),
    queryFn: ({ signal }) => getConversation(id ?? "", signal),
    enabled: id !== null,
    // A conversa já chega montada no cache depois de cada pergunta: não precisa buscar de novo.
    staleTime: 30_000,
  });
}
