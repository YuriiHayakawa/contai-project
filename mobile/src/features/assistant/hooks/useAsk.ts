import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { isApiError } from "@/lib/api-client";

import { createConversation, sendMessage } from "../services/assistant";
import type { AssistantUsage, ChatMessage, ConversationDetail } from "../types";
import { conversationQueryKey } from "./useConversation";
import { conversationsQueryKey, usageQueryKey } from "./useConversations";

export interface AskVariables {
  /** Sem conversa aberta, a pergunta começa uma. */
  conversationId: string | null;
  content: string;
}

export interface AskResult {
  conversationId: string;
  reply: ChatMessage;
}

// Como no servidor: o título da conversa é o começo da primeira pergunta.
const TITLE_LENGTH = 80;

/** O limite diário de perguntas acabou (`429 ai_limit_reached`, FR-071). */
export function isLimitReached(error: unknown): boolean {
  return isApiError(error) && error.code === "ai_limit_reached";
}

/**
 * Faz uma pergunta e guarda a pergunta e a resposta na conversa, como no site. Se a pergunta
 * falha, nada fica gravado no servidor: a tela mantém o texto e oferece tentar de novo.
 */
export function useAsk() {
  const queryClient = useQueryClient();
  // A conversa criada para uma pergunta que falhou serve para a nova tentativa.
  const createdId = useRef<string | null>(null);

  return useMutation({
    mutationFn: async ({ conversationId, content }: AskVariables): Promise<AskResult> => {
      const id = conversationId ?? createdId.current ?? (await createConversation()).id;
      if (conversationId === null) createdId.current = id;
      return { conversationId: id, reply: await sendMessage(id, content) };
    },
    onSuccess: ({ conversationId, reply }, { content }) => {
      createdId.current = null;
      const question: ChatMessage = {
        id: `pergunta-${reply.id}`,
        role: "user",
        kind: "text",
        content,
        highlight: null,
        transactions: [],
        transactions_total_count: 0,
        proposal: null,
        created_at: reply.created_at,
      };
      queryClient.setQueryData<ConversationDetail>(
        conversationQueryKey(conversationId),
        (current) => ({
          id: conversationId,
          title: current?.title || content.slice(0, TITLE_LENGTH),
          created_at: current?.created_at ?? reply.created_at,
          updated_at: reply.created_at,
          messages: [...(current?.messages ?? []), question, reply],
        }),
      );
      void queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
    },
    onError: (error) => {
      // O limite acabou antes de a tela saber: o campo dá lugar ao aviso, com o horário do erro.
      const resetsAt = isApiError(error) ? error.details?.resets_at : undefined;
      if (!isLimitReached(error) || typeof resetsAt !== "string") return;
      queryClient.setQueryData<AssistantUsage>(usageQueryKey, (current) => ({
        used: current?.limit ?? 0,
        limit: current?.limit ?? 0,
        remaining: 0,
        resets_at: resetsAt,
      }));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: usageQueryKey });
    },
  });
}
