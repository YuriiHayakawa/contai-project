// Tipos das rotas do Assistente (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";
import type { TransactionType } from "../transactions/types";

export type MessageRole = "user" | "assistant";

/**
 * - `text`: a pergunta do usuário.
 * - `answer`: resposta com números, que pode trazer o valor principal e as transações.
 * - `clarification`: o assistente pede o que falta para responder.
 * - `refusal`: pergunta fora do tema das finanças do usuário.
 * - `transaction_proposal`: lançamento sugerido a partir de um texto (história 8).
 * - `error`: o assistente não conseguiu montar uma resposta segura.
 */
export type MessageKind =
  "text" | "answer" | "clarification" | "refusal" | "transaction_proposal" | "error";

/** Uma das transações que compõem o valor de uma resposta (FR-063). */
export interface SourceTransaction {
  id: string;
  type: TransactionType;
  date: ISODate;
  description: string;
  /** Sempre positivo, em centavos; o sinal vem do tipo. */
  amount_cents: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  /** O valor principal, como está escrito em `content`; nulo quando a resposta não tem um. */
  highlight: string | null;
  /** Até 50 das transações que compõem a resposta, das que ainda existem. */
  transactions: SourceTransaction[];
  /** Quantas transações compõem a resposta ao todo. */
  transactions_total_count: number;
  proposal: Record<string, unknown> | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  /** O começo da primeira pergunta; vazio enquanto a conversa não tem pergunta. */
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  /** Da mensagem mais antiga para a mais nova. */
  messages: ChatMessage[];
}

export interface ConversationPage {
  items: Conversation[];
  next_cursor: string | null;
}

/** Perguntas feitas hoje e o limite do dia, que zera à meia-noite de Brasília (FR-071). */
export interface AssistantUsage {
  used: number;
  limit: number;
  remaining: number;
  /** Instante em que o limite zera. */
  resets_at: string;
}

/** Tamanho máximo de uma pergunta, igual ao do servidor. */
export const MAX_QUESTION_LENGTH = 1000;
