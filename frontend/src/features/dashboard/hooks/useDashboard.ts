import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { YearMonth } from "../../../lib/dates";
import { useTransactionCount } from "../../transactions/hooks/useTransactions";
import { dashboardQueryKey } from "../query-key";
import {
  getCards,
  getCategories,
  getSummary,
  getTopExpenses,
  getTrend,
} from "../services/dashboardService";
import type {
  DashboardCards,
  DashboardCategories,
  DashboardSummary,
  DashboardTopExpenses,
  DashboardTrend,
} from "../types";

interface DashboardData {
  summary: DashboardSummary;
  categories: DashboardCategories;
  trend: DashboardTrend;
  topExpenses: DashboardTopExpenses;
  cards: DashboardCards;
}

/**
 * - `loading`: a primeira carga ainda não terminou.
 * - `error`: alguma parte falhou e não há o que mostrar; `retry` tenta de novo.
 * - `welcome`: o usuário ainda não tem nenhum lançamento; a tela mostra os primeiros passos.
 * - `ready`: os números do mês estão na tela.
 */
export type Dashboard =
  | { status: "loading" }
  | { status: "error"; error: unknown; retry: () => void }
  | ({ status: "welcome" | "ready"; isUpdating: boolean } & DashboardData);

// O painel é a tela de entrada: confere os números toda vez que é aberto. O que está em memória
// aparece na hora e é trocado quando a resposta chega.
const ALWAYS_FRESH = { staleTime: 0, placeholderData: keepPreviousData } as const;

/**
 * Números do painel para um mês: resumo, gastos por categoria, evolução e maiores gastos. Ao
 * trocar de mês, os números anteriores ficam na tela (`isUpdating`) até os novos chegarem.
 */
export function useDashboard(month: YearMonth): Dashboard {
  const summary = useQuery({
    queryKey: [...dashboardQueryKey, "summary", month],
    queryFn: ({ signal }) => getSummary(month, signal),
    ...ALWAYS_FRESH,
  });
  const categories = useQuery({
    queryKey: [...dashboardQueryKey, "categories", month],
    queryFn: ({ signal }) => getCategories(month, signal),
    ...ALWAYS_FRESH,
  });
  const trend = useQuery({
    queryKey: [...dashboardQueryKey, "trend", month],
    queryFn: ({ signal }) => getTrend(month, signal),
    ...ALWAYS_FRESH,
  });
  const topExpenses = useQuery({
    queryKey: [...dashboardQueryKey, "top-expenses", month],
    queryFn: ({ signal }) => getTopExpenses(month, signal),
    ...ALWAYS_FRESH,
  });
  const cards = useQuery({
    queryKey: [...dashboardQueryKey, "cards", month],
    queryFn: ({ signal }) => getCards(month, signal),
    ...ALWAYS_FRESH,
  });
  const transactionCount = useTransactionCount();

  const queries = [summary, categories, trend, topExpenses, cards, transactionCount];

  if (
    summary.data === undefined ||
    categories.data === undefined ||
    trend.data === undefined ||
    topExpenses.data === undefined ||
    cards.data === undefined ||
    transactionCount.data === undefined
  ) {
    const failed = queries.find((query) => query.isError);
    if (!failed) return { status: "loading" };
    return {
      status: "error",
      error: failed.error,
      retry: () => {
        for (const query of queries) {
          if (query.isError) void query.refetch();
        }
      },
    };
  }

  return {
    status: transactionCount.data === 0 ? "welcome" : "ready",
    isUpdating: [summary, categories, trend, topExpenses, cards].some(
      (query) => query.isPlaceholderData,
    ),
    summary: summary.data,
    categories: categories.data,
    trend: trend.data,
    topExpenses: topExpenses.data,
    cards: cards.data,
  };
}
