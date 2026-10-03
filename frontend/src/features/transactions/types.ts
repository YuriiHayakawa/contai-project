// Tipos das rotas de Transações (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";

export type TransactionType = "expense" | "income" | "transfer";
/** Despesa ou receita: o que leva categoria. Transferência tem rota própria. */
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

/** Corpo de `POST /transactions`: uma despesa ou uma receita. */
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

/** Corpo de `POST /transactions/installments`: uma compra parcelada no cartão. */
export interface InstallmentsInput {
  total_cents: number;
  /** De 2 a 48. */
  installments: number;
  /** Data da compra, que é a da primeira parcela. */
  date: ISODate;
  description: string;
  account_id: string;
  category_id: string;
  notes: string | null;
}

/** Corpo de `POST /transactions/transfers`. */
export interface TransferInput {
  from_account_id: string;
  to_account_id: string;
  amount_cents: number;
  date: ISODate;
  description: string;
  notes: string | null;
}

/** Corpo de `PATCH /transactions/{id}`: só os campos enviados mudam. */
export type TransactionPatch = Partial<TransactionInput>;

/**
 * Alcance de uma edição ou exclusão de parcela (FR-032): só a escolhida, ou ela e as seguintes
 * da mesma compra. As anteriores nunca mudam.
 */
export type EditScope = "single" | "following";

/** Lançamentos criados ou alterados juntos: as parcelas de uma compra ou uma transferência. */
export interface TransactionList {
  items: Transaction[];
}

/**
 * O que já vem preenchido ao abrir a folha de lançamento, como no "Pagar fatura" de um cartão:
 * uma transferência para o cartão, com o valor da fatura.
 */
export interface TransactionPreset {
  type?: TransactionType;
  amountCents?: number;
  description?: string;
  fromAccountId?: string;
  toAccountId?: string;
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
  /** As parcelas de uma compra. */
  installment_group_id?: string;
  /** Os dois lados de uma transferência. */
  transfer_group_id?: string;
}

export interface TransactionPage {
  items: Transaction[];
  next_cursor: string | null;
  /** Quantos lançamentos atendem aos filtros, somando todas as páginas. */
  total_count: number;
}
