// Tipos das rotas de Transações (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";

export type TransactionType = "expense" | "income" | "transfer";
/** O que o formulário de lançamento cria: transferência tem rota e tela próprias. */
export type EntryType = Exclude<TransactionType, "transfer">;

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Só em transferência: de que lado da transferência esta linha está. */
  transfer_direction: "out" | "in" | null;
  /** Sempre positivo, em centavos; o sinal vem do tipo. */
  amount_cents: number;
  date: ISODate;
  description: string;
  notes: string | null;
  account_id: string;
  /** Nulo só em transferência. */
  category_id: string | null;
  transfer_group_id: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  source: "manual" | "import" | "assistant";
  created_at: string;
}

/** Corpo de `POST /transactions` e de `PATCH /transactions/{id}`. */
export interface TransactionInput {
  type: EntryType;
  amount_cents: number;
  date: ISODate;
  description: string;
  account_id: string;
  category_id: string;
  /** `null` deixa o lançamento sem observação. */
  notes: string | null;
}

/** Filtros de `GET /transactions`: só voltam os lançamentos que atendem a todos. */
export interface TransactionFilters {
  from?: ISODate;
  to?: ISODate;
  account_id?: string;
  /** Inclui as subcategorias da categoria. */
  category_id?: string;
  type?: TransactionType;
  /** Texto procurado na descrição e na observação. */
  q?: string;
}

export interface TransactionPage {
  items: Transaction[];
  next_cursor: string | null;
  /** Quantos lançamentos atendem aos filtros, somando todas as páginas. */
  total_count: number;
}
