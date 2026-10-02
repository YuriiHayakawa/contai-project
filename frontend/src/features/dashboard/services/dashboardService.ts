// Chamadas HTTP do painel. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { YearMonth } from "../../../lib/dates";
import type {
  DashboardCategories,
  DashboardSummary,
  DashboardTopExpenses,
  DashboardTrend,
} from "../types";

export const TREND_MONTHS = 6;
export const TOP_EXPENSES_LIMIT = 5;

export function getSummary(month: YearMonth, signal?: AbortSignal): Promise<DashboardSummary> {
  return api.get<DashboardSummary>("/dashboard/summary", { params: { month }, signal });
}

export function getCategories(
  month: YearMonth,
  signal?: AbortSignal,
): Promise<DashboardCategories> {
  return api.get<DashboardCategories>("/dashboard/categories", { params: { month }, signal });
}

/** Os seis meses que terminam no mês exibido. */
export function getTrend(month: YearMonth, signal?: AbortSignal): Promise<DashboardTrend> {
  return api.get<DashboardTrend>("/dashboard/trend", {
    params: { until: month, months: TREND_MONTHS },
    signal,
  });
}

export function getTopExpenses(
  month: YearMonth,
  signal?: AbortSignal,
): Promise<DashboardTopExpenses> {
  return api.get<DashboardTopExpenses>("/dashboard/top-expenses", {
    params: { month, limit: TOP_EXPENSES_LIMIT },
    signal,
  });
}
