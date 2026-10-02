import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { ApiError } from "../../../lib/api-client";
import * as transactionsService from "../../transactions/services/transactionsService";
import * as dashboardService from "../services/dashboardService";
import type {
  DashboardCategories,
  DashboardSummary,
  DashboardTopExpenses,
  DashboardTrend,
} from "../types";
import { useDashboard } from "./useDashboard";

vi.mock("../services/dashboardService");
vi.mock("../../transactions/services/transactionsService");

const getSummary = vi.mocked(dashboardService.getSummary);
const getCategories = vi.mocked(dashboardService.getCategories);
const getTrend = vi.mocked(dashboardService.getTrend);
const getTopExpenses = vi.mocked(dashboardService.getTopExpenses);
const countTransactions = vi.mocked(transactionsService.countTransactions);

function summaryOf(month: string, expense: number): DashboardSummary {
  return {
    month,
    income_cents: 545_000,
    expense_cents: expense,
    net_cents: 545_000 - expense,
    accounts: [{ id: "acc-1", name: "Conta Nubank", type: "checking", balance_cents: 218_435 }],
  };
}

function categoriesOf(month: string, total: number): DashboardCategories {
  return {
    month,
    total_cents: total,
    items:
      total === 0
        ? []
        : [
            {
              category_id: "cat-1",
              name: "Moradia",
              icon: "house",
              color: "mata",
              amount_cents: total,
              percent: 100,
              subcategories: [],
            },
          ],
  };
}

const trendOf = (month: string): DashboardTrend => ({
  items: [{ month, income_cents: 545_000, expense_cents: 397_240, net_cents: 147_760 }],
});
const topOf = (month: string): DashboardTopExpenses => ({ month, items: [] });

/** A API falsa responde a qualquer mês; cada teste pode segurar ou derrubar uma resposta. */
function answerEveryMonth(): void {
  getSummary.mockImplementation((month) => Promise.resolve(summaryOf(month, 397_240)));
  getCategories.mockImplementation((month) => Promise.resolve(categoriesOf(month, 397_240)));
  getTrend.mockImplementation((month) => Promise.resolve(trendOf(month)));
  getTopExpenses.mockImplementation((month) => Promise.resolve(topOf(month)));
  countTransactions.mockResolvedValue(42);
}

function renderDashboard(initialMonth: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(({ month }) => useDashboard(month), {
    wrapper,
    initialProps: { month: initialMonth },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  answerEveryMonth();
});

describe("useDashboard", () => {
  it("começa carregando e entrega os números do mês pedido", async () => {
    const { result } = renderDashboard("2026-09");

    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const dashboard = result.current;
    if (dashboard.status !== "ready") throw new Error("o painel não ficou pronto");
    expect(dashboard.summary).toEqual(summaryOf("2026-09", 397_240));
    expect(dashboard.categories.total_cents).toBe(397_240);
    expect(dashboard.trend.items).toHaveLength(1);
    expect(dashboard.topExpenses).toEqual(topOf("2026-09"));
    expect(dashboard.isUpdating).toBe(false);
    for (const service of [getSummary, getCategories, getTrend, getTopExpenses]) {
      expect(service).toHaveBeenCalledWith("2026-09", expect.anything());
    }
  });

  it("troca de mês: mantém os números anteriores na tela até os novos chegarem", async () => {
    const { result, rerender } = renderDashboard("2026-09");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let release: (value: DashboardSummary) => void = () => undefined;
    getSummary.mockImplementation(
      () =>
        new Promise<DashboardSummary>((resolve) => {
          release = resolve;
        }),
    );

    rerender({ month: "2026-08" });

    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith("2026-08", expect.anything()));
    let dashboard = result.current;
    if (dashboard.status !== "ready") throw new Error("o painel saiu da tela ao trocar de mês");
    expect(dashboard.isUpdating).toBe(true);
    expect(dashboard.summary.month).toBe("2026-09");

    act(() => release(summaryOf("2026-08", 376_000)));

    await waitFor(() => {
      const current = result.current;
      expect(current.status === "ready" && current.isUpdating).toBe(false);
    });
    dashboard = result.current;
    if (dashboard.status !== "ready") throw new Error("o painel não ficou pronto");
    expect(dashboard.summary).toEqual(summaryOf("2026-08", 376_000));
    expect(dashboard.categories.month).toBe("2026-08");
    expect(getTrend).toHaveBeenLastCalledWith("2026-08", expect.anything());
    expect(getTopExpenses).toHaveBeenLastCalledWith("2026-08", expect.anything());
  });

  it("voltar a um mês já visto mostra os números guardados e confere de novo", async () => {
    const { result, rerender } = renderDashboard("2026-09");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ month: "2026-08" });
    await waitFor(() =>
      expect(result.current.status === "ready" && result.current.summary.month).toBe("2026-08"),
    );
    const callsBefore = getSummary.mock.calls.length;

    rerender({ month: "2026-09" });

    const dashboard = result.current;
    if (dashboard.status !== "ready") throw new Error("o painel saiu da tela ao voltar");
    expect(dashboard.summary.month).toBe("2026-09");
    expect(dashboard.isUpdating).toBe(false);
    await waitFor(() => expect(getSummary.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("erro na primeira carga: informa o erro e tenta de novo só o que falhou", async () => {
    const failure = new ApiError({
      status: 0,
      code: "network_error",
      message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
    });
    getCategories.mockRejectedValue(failure);
    const { result } = renderDashboard("2026-09");

    await waitFor(() => expect(result.current.status).toBe("error"));
    const failed = result.current;
    if (failed.status !== "error") throw new Error("o painel não informou o erro");
    expect(failed.error).toBe(failure);

    getCategories.mockImplementation((month) => Promise.resolve(categoriesOf(month, 397_240)));
    act(() => failed.retry());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getCategories).toHaveBeenCalledTimes(2);
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it("usuário sem nenhum lançamento: painel de boas-vindas, com as contas que já existem", async () => {
    countTransactions.mockResolvedValue(0);
    getSummary.mockImplementation((month) =>
      Promise.resolve({ ...summaryOf(month, 0), income_cents: 0, net_cents: 0 }),
    );
    getCategories.mockImplementation((month) => Promise.resolve(categoriesOf(month, 0)));
    const { result } = renderDashboard("2026-10");

    await waitFor(() => expect(result.current.status).toBe("welcome"));
    const dashboard = result.current;
    if (dashboard.status !== "welcome") throw new Error("o painel não mostrou as boas-vindas");
    expect(dashboard.summary.accounts).toHaveLength(1);
    expect(dashboard.categories.items).toEqual([]);
  });

  it("mês sem lançamentos de quem já tem lançamentos em outros meses não é boas-vindas", async () => {
    getSummary.mockImplementation((month) =>
      Promise.resolve({ ...summaryOf(month, 0), income_cents: 0, net_cents: 0 }),
    );
    getCategories.mockImplementation((month) => Promise.resolve(categoriesOf(month, 0)));
    const { result } = renderDashboard("2026-12");

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
