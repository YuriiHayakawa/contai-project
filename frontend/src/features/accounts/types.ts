// Tipos das rotas de Contas (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";

export type AccountType = "checking" | "credit_card" | "cash" | "savings" | "investment";

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  institution: string | null;
  /** Com sinal: a dívida inicial de um cartão é negativa. */
  initial_balance_cents: number;
  /** Só os lançamentos a partir desta data entram no saldo. */
  initial_balance_date: ISODate;
  /** Dias de fechamento e de vencimento: só existem em cartão de crédito. */
  closing_day: number | null;
  due_day: number | null;
  archived: boolean;
  /** Saldo inicial mais os lançamentos entre a data de referência e hoje. */
  balance_cents: number;
}

/** Corpo do cadastro e da edição: o formulário envia sempre todos os campos. */
export interface AccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  initial_balance_cents: number;
  initial_balance_date: ISODate;
  closing_day: number | null;
  due_day: number | null;
}

export interface AccountList {
  items: Account[];
}

/** Nome de cada tipo de conta, na ordem em que aparece na escolha. */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conta corrente",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  savings: "Poupança",
  investment: "Investimento",
};
