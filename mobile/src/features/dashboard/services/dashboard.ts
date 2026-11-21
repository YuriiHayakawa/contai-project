// Os números do painel vêm prontos da API, os mesmos do site (FR-007): o app não calcula nada.
import type { DashboardCategories, DashboardSummary } from "@web/features/dashboard/types";
import type { TransactionPage } from "@web/features/transactions/types";
import type { YearMonth } from "@web/lib/dates";

import { api } from "@/lib/api-client";

export function getSummary(month: YearMonth, signal?: AbortSignal): Promise<DashboardSummary> {
  return api.get<DashboardSummary>("/dashboard/summary", { params: { month }, signal });
}

export function getCategories(
  month: YearMonth,
  signal?: AbortSignal,
): Promise<DashboardCategories> {
  return api.get<DashboardCategories>("/dashboard/categories", { params: { month }, signal });
}

/** Quantos lançamentos o usuário tem ao todo: sem nenhum, o painel mostra os primeiros passos. */
export async function countTransactions(signal?: AbortSignal): Promise<number> {
  const page = await api.get<TransactionPage>("/transactions", { params: { limit: 1 }, signal });
  return page.total_count;
}
