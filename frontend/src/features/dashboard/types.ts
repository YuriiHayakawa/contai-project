// Tipos das rotas do Painel (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate, YearMonth } from "../../lib/dates";
import type { AccountType } from "../accounts/types";
import type { Transaction } from "../transactions/types";

/** Entradas, saídas e saldo de um mês. Transferências não entram em nenhum dos três. */
export interface PeriodTotals {
  /** Receitas, sem os estornos. */
  income_cents: number;
  /** Despesas menos os estornos, que são receitas lançadas em categoria de despesa. */
  expense_cents: number;
  /** Entradas menos saídas; negativo quando o mês fechou no vermelho. */
  net_cents: number;
}

export interface AccountBalance {
  id: string;
  name: string;
  type: AccountType;
  balance_cents: number;
}

export interface DashboardSummary extends PeriodTotals {
  month: YearMonth;
  /** Contas ativas, em ordem alfabética, com o saldo de hoje. */
  accounts: AccountBalance[];
}

export interface SubcategorySpending {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  /** Despesas menos estornos; negativo quando o estorno cai em um mês e a compra, em outro. */
  amount_cents: number;
  /** Parte do que foi gasto no mês; zero quando o valor é negativo. */
  percent: number;
}

/** Gastos de uma categoria principal, já com os das subcategorias somados. */
export interface CategorySpending extends SubcategorySpending {
  subcategories: SubcategorySpending[];
}

export interface DashboardCategories {
  month: YearMonth;
  /** Total de despesas do mês: a soma das categorias. */
  total_cents: number;
  /** Da categoria com mais gasto para a com menos. */
  items: CategorySpending[];
}

export interface MonthTotals extends PeriodTotals {
  month: YearMonth;
}

export interface DashboardTrend {
  /** Do mês mais antigo para o mais novo; mês sem lançamentos vem com zeros. */
  items: MonthTotals[];
}

export interface DashboardTopExpenses {
  month: YearMonth;
  /** Da maior despesa para a menor. */
  items: Transaction[];
}

/** Fatura de um cartão: as compras de `period_start` a `period_end`, inclusive. */
export interface InvoiceSummary {
  period_start: ISODate;
  period_end: ISODate;
  closing_date: ISODate;
  due_date: ISODate;
  /** Compras menos estornos do período; o pagamento da fatura não entra. */
  amount_cents: number;
}

export interface MonthAmount {
  month: YearMonth;
  amount_cents: number;
}

/** A última fatura fechada, com o que ainda falta pagar dela. */
export interface ClosedInvoiceDue {
  closing_date: ISODate;
  due_date: ISODate;
  /** O que se deve das faturas fechadas: as compras delas menos os pagamentos já feitos. */
  amount_cents: number;
}

/** O que pagar no cartão hoje, seja qual for o mês exibido. */
export interface InvoicePayment {
  /** `null` quando as faturas fechadas já estão pagas e só a atual, ainda aberta, tem valor. */
  closed_invoice: ClosedInvoiceDue | null;
  /** Tudo o que se deve no cartão hoje, inclusive as compras da fatura que ainda não fechou. */
  total_due_cents: number;
}

export interface CardSummary {
  account_id: string;
  name: string;
  closing_day: number;
  due_day: number;
  current_invoice: InvoiceSummary;
  future_installments: {
    total_cents: number;
    /** Por mês de vencimento da fatura em que cada parcela cai. */
    months: MonthAmount[];
  };
  payment: InvoicePayment;
}

export interface DashboardCards {
  /** Cartões ativos, em ordem alfabética. */
  items: CardSummary[];
}
