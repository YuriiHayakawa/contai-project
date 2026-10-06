// Chamadas HTTP do assistente. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type {
  AssistantUsage,
  ChatMessage,
  Conversation,
  ConversationDetail,
  ConversationPage,
} from "../types";

interface SuggestionList {
  items: string[];
}

/** Perguntas de exemplo para o chat vazio (FR-070). Texto fixo, sem uso de IA. */
export async function listSuggestions(signal?: AbortSignal): Promise<string[]> {
  const { items } = await api.get<SuggestionList>("/assistant/suggestions", { signal });
  return items;
}

/** Quantas perguntas já foram feitas hoje, o limite do dia e quando ele zera. */
export function getUsage(signal?: AbortSignal): Promise<AssistantUsage> {
  return api.get<AssistantUsage>("/assistant/usage", { signal });
}

/** Uma página do histórico, da conversa com atividade mais recente para a mais antiga. */
export function listConversations(
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  return api.get<ConversationPage>("/assistant/conversations", { params: { cursor }, signal });
}

export function createConversation(): Promise<Conversation> {
  return api.post<Conversation>("/assistant/conversations");
}

/** A conversa com as mensagens, da mais antiga para a mais nova. */
export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return api.get<ConversationDetail>(`/assistant/conversations/${id}`, { signal });
}

/**
 * Faz uma pergunta e devolve a resposta do assistente. Se o limite do dia acabou ou o serviço
 * de IA não respondeu, nada é gravado no servidor: nem a pergunta, nem o uso do dia.
 */
export function sendMessage(conversationId: string, content: string): Promise<ChatMessage> {
  return api.post<ChatMessage>(`/assistant/conversations/${conversationId}/messages`, { content });
}

export function deleteConversation(id: string): Promise<void> {
  return api.delete(`/assistant/conversations/${id}`);
}

/** Apaga todo o histórico de conversas (FR-069). */
export function deleteAllConversations(): Promise<void> {
  return api.delete("/assistant/conversations");
}

/**
 * Guarda na proposta qual lançamento o usuário salvou a partir dela. O lançamento em si é
 * criado pelo formulário, depois da conferência.
 */
export function markProposalSaved(messageId: string, transactionId: string): Promise<void> {
  return api.post(`/assistant/messages/${messageId}/proposal/saved`, {
    transaction_id: transactionId,
  });
}

/** Descarta uma proposta de lançamento; nada é salvo. */
export function discardProposal(messageId: string): Promise<void> {
  return api.post(`/assistant/messages/${messageId}/proposal/discarded`);
}
