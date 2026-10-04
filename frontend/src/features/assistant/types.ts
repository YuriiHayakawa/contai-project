// Tipos das rotas do Assistente (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";
import type { EntryType, TransactionType } from "../transactions/types";

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
  /** A conta do lançamento; em uma transferência, a conta de onde o dinheiro saiu. */
  account_id: string;
  /** Só em transferência: a conta em que o dinheiro entrou. */
  to_account_id: string | null;
  /** Nula em transferência. */
  category_id: string | null;
}

/**
 * - `pending`: à espera; nada foi salvo.
 * - `saved`: o usuário conferiu e salvou; `transaction_id` é o lançamento.
 * - `discarded`: o usuário descartou a proposta.
 */
export type ProposalStatus = "pending" | "saved" | "discarded";

/**
 * Transação proposta a partir de uma frase (FR-066). Nada dela é salvo antes de o usuário
 * conferir no formulário (FR-067). Depois de salva, os campos são os do lançamento gravado.
 */
export interface Proposal {
  type: EntryType;
  amount_cents: number;
  date: ISODate;
  description: string;
  /** Nulas quando a frase não deixou claro: o usuário escolhe ao conferir. */
  account_id: string | null;
  category_id: string | null;
  /** De onde veio a categoria: de uma regra que o usuário ensinou ou de uma sugestão da IA. */
  category_source: "user_rule" | "ai" | null;
  status: ProposalStatus;
  transaction_id: string | null;
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
  /** Só em `transaction_proposal`. */
  proposal: Proposal | null;
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
