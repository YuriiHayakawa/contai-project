import type { DashboardCategories, DashboardSummary } from "@web/features/dashboard/types";
import type { YearMonth } from "@web/lib/dates";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";

import { dashboardQueryKey, transactionsQueryKey } from "../../transactions/hooks/useTransactions";
import { countTransactions, getCategories, getSummary } from "../services/dashboard";

export type DashboardState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "welcome" | "ready";
      summary: DashboardSummary;
      categories: DashboardCategories;
    };

/**
 * O painel de um mês: entradas, saídas e saldo, gastos por categoria e saldo das contas. Volta a
 * consultar ao voltar ao app e à tela, para mostrar logo o que a Siri lançou (SC-004).
 */
export function useDashboard(month: YearMonth) {
  const summary = useQuery({
    queryKey: [...dashboardQueryKey, "summary", month],
    queryFn: ({ signal }) => getSummary(month, signal),
    // Ao trocar de mês, os números anteriores ficam até os novos chegarem: a tela não pisca
    // para "Carregando…" nem volta a rolagem para o topo.
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: [...dashboardQueryKey, "categories", month],
    queryFn: ({ signal }) => getCategories(month, signal),
    placeholderData: keepPreviousData,
  });
  // A contagem é de lançamentos: um lançamento novo, em qualquer tela, a atualiza.
  const count = useQuery({
    queryKey: [...transactionsQueryKey, "count"],
    queryFn: ({ signal }) => countTransactions(signal),
  });

  const refetch = async (): Promise<void> => {
    await Promise.all([summary.refetch(), categories.refetch(), count.refetch()]);
  };
  useRefetchOnFocus(refetch);

  let state: DashboardState;
  const error = summary.error ?? categories.error ?? count.error;
  if (error) state = { status: "error", error };
  else if (!summary.data || !categories.data || count.data === undefined) {
    state = { status: "loading" };
  } else {
    state = {
      status: count.data === 0 ? "welcome" : "ready",
      summary: summary.data,
      categories: categories.data,
    };
  }

  return { ...state, refetch };
}
