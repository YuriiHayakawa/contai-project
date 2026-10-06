import { useQuery } from "@tanstack/react-query";

import { getUsage, listSuggestions } from "../services/assistantService";
import { assistantQueryKey } from "./useConversation";

export const usageQueryKey = [...assistantQueryKey, "usage"] as const;

/** Perguntas feitas hoje, quantas restam e quando o limite zera (FR-071). */
export function useAssistantUsage() {
  return useQuery({
    queryKey: usageQueryKey,
    queryFn: ({ signal }) => getUsage(signal),
  });
}

/** Perguntas de exemplo para o chat vazio (FR-070). O texto é fixo: basta buscar uma vez. */
export function useSuggestions() {
  return useQuery({
    queryKey: [...assistantQueryKey, "suggestions"],
    queryFn: ({ signal }) => listSuggestions(signal),
    staleTime: Infinity,
  });
}
