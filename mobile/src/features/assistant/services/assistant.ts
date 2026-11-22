// Chamadas do assistente, as mesmas do site: as conversas são compartilhadas (FR-012).
import { api } from "@/lib/api-client";

import type {
  AssistantUsage,
  ChatMessage,
  Conversation,
  ConversationDetail,
  ConversationPage,
} from "../types";

/** Perguntas feitas hoje, o limite do dia e quando ele zera. */
export function getUsage(signal?: AbortSignal): Promise<AssistantUsage> {
  return api.get<AssistantUsage>("/assistant/usage", { signal });
}

/** Uma página do histórico, da conversa mais recente para a mais antiga. */
export function listConversations(
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  return api.get<ConversationPage>("/assistant/conversations", { params: { cursor }, signal });
}

export function createConversation(): Promise<Conversation> {
  return api.post<Conversation>("/assistant/conversations");
}

export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return api.get<ConversationDetail>(`/assistant/conversations/${id}`, { signal });
}

/** Faz uma pergunta. Se falhar, o servidor não grava nem a pergunta nem o uso do dia. */
export function sendMessage(conversationId: string, content: string): Promise<ChatMessage> {
  return api.post<ChatMessage>(`/assistant/conversations/${conversationId}/messages`, {
    content,
  });
}

export function deleteConversation(id: string): Promise<void> {
  return api.delete<void>(`/assistant/conversations/${id}`);
}

/** Guarda na proposta qual lançamento foi salvo a partir dela. */
export function markProposalSaved(messageId: string, transactionId: string): Promise<void> {
  return api.post<void>(`/assistant/messages/${messageId}/proposal/saved`, {
    transaction_id: transactionId,
  });
}

/** Descarta a proposta: nada é salvo. */
export function discardProposal(messageId: string): Promise<void> {
  return api.post<void>(`/assistant/messages/${messageId}/proposal/discarded`);
}
