import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { isApiError } from "../../../lib/api-client";
import { createConversation, sendMessage } from "../services/assistantService";
import type { AssistantUsage, ChatMessage, ConversationDetail } from "../types";
import { usageQueryKey } from "./useAssistantUsage";
import { conversationQueryKey } from "./useConversation";
import { conversationsQueryKey } from "./useConversations";

export interface SendVariables {
  /** Sem conversa aberta, a pergunta começa uma. */
  conversationId: string | undefined;
  content: string;
  /** Id da pergunta enquanto ela só existe na tela; a rota devolve só a resposta. */
  localId: string;
}

export interface SendResult {
  conversationId: string;
  reply: ChatMessage;
}

// Igual ao do servidor: o título da conversa é o começo da primeira pergunta.
const TITLE_LENGTH = 80;

/** O limite diário de perguntas do usuário foi atingido (`429 ai_limit_reached`, FR-071). */
export function isLimitReached(error: unknown): boolean {
  return isApiError(error) && error.code === "ai_limit_reached";
}

/**
 * Envia uma pergunta e guarda a pergunta e a resposta na conversa. Quando a pergunta falha, o
 * servidor não grava nada (nem a pergunta, nem o uso do dia): a tela mantém o texto e oferece
 * tentar de novo.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  // A conversa criada para uma pergunta que falhou serve à nova tentativa: não se cria outra.
  const createdId = useRef<string | undefined>(undefined);

  return useMutation({
    mutationFn: async ({ conversationId, content }: SendVariables): Promise<SendResult> => {
      const id = conversationId ?? createdId.current ?? (await createConversation()).id;
      if (conversationId === undefined) createdId.current = id;
      return { conversationId: id, reply: await sendMessage(id, content) };
    },
    onSuccess: ({ conversationId, reply }, { content, localId }) => {
      createdId.current = undefined;
      const question: ChatMessage = {
        id: localId,
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
      // O limite acabou antes de a tela saber (em outra aba, por exemplo): o campo de escrita
      // já dá lugar ao aviso, com o horário que veio no erro, enquanto o uso do dia é relido.
      const resetsAt = isApiError(error) ? error.details?.resets_at : undefined;
      if (!isLimitReached(error) || typeof resetsAt !== "string") return;
      queryClient.setQueryData<AssistantUsage>(usageQueryKey, (current) => ({
        used: current?.limit ?? 0,
        limit: current?.limit ?? 0,
        remaining: 0,
        resets_at: resetsAt,
      }));
    },
    // Com resposta ou com erro, o uso do dia pode ter mudado: é ele que diz quantas restam.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: usageQueryKey });
    },
  });
}
