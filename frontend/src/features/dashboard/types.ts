// Tipos das rotas do Painel (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { YearMonth } from "../../lib/dates";
import type { AccountType } from "../accounts/types";
import type { Transaction } from "../transactions/types";

/** Entradas, saídas e saldo de um mês. Transferências não entram em nenhum dos três. */
export interface PeriodTotals {
  income_cents: number;
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
  amount_cents: number;
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
