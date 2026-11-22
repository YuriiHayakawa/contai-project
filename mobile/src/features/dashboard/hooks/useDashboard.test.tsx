import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { DashboardCategories, DashboardSummary } from "@web/features/dashboard/types";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { createTestQueryClient } from "@/test-utils";

import { DashboardView } from "../components/DashboardView";
import * as service from "../services/dashboard";
import { useDashboard } from "./useDashboard";

jest.mock("../services/dashboard");
jest.mock("../../transactions/components/VoiceHighlights", () => ({ VoiceHighlights: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

const getSummary = jest.mocked(service.getSummary);
const getCategories = jest.mocked(service.getCategories);
const countTransactions = jest.mocked(service.countTransactions);

function summary(month: string, extra: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    month,
    income_cents: 500000,
    expense_cents: 250000,
    net_cents: 250000,
    accounts: [{ id: "acc", name: "Nubank", type: "checking", balance_cents: 120000 }],
    ...extra,
  };
}

function categories(month: string): DashboardCategories {
  return { month, total_cents: 250000, items: [] };
}

/** Deixa as respostas simuladas da API chegarem dentro do `act`. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

let queryClient = createTestQueryClient();

// Um cache só por teste: o `rerender` não pode trocar de cache no meio.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = createTestQueryClient();
  [getSummary, getCategories, countTransactions].forEach((mock) => mock.mockReset());
  getSummary.mockImplementation(async (month) => summary(month));
  getCategories.mockImplementation(async (month) => categories(month));
  countTransactions.mockResolvedValue(12);
});

describe("painel do mês", () => {
  it("trocar o mês refaz a consulta", async () => {
    const { result, rerender } = await renderHook(
      ({ month }: { month: string }) => useDashboard(month),
      { wrapper, initialProps: { month: "2026-11" } },
    );
    await settle();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await rerender({ month: "2026-10" });
    await settle();

    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith("2026-10", expect.anything()));
    expect(getCategories).toHaveBeenLastCalledWith("2026-10", expect.anything());
  });

  it("sem nenhum lançamento, mostra os primeiros passos", async () => {
    countTransactions.mockResolvedValue(0);

    await render(<DashboardView />, { wrapper });
    await settle();

    expect(await screen.findByText("Faça seu primeiro lançamento")).toBeOnTheScreen();
  });

  it("mostra entradas, saídas, saldo e as contas, com os números da API", async () => {
    await render(<DashboardView />, { wrapper });
    await settle();

    expect(await screen.findByLabelText("Entradas: 5.000 reais")).toBeOnTheScreen();
    expect(screen.getByLabelText("Saídas: 2.500 reais")).toBeOnTheScreen();
    expect(screen.getByLabelText("Saldo do mês: 2.500 reais")).toBeOnTheScreen();
    expect(screen.getByLabelText("Nubank: 1.200 reais")).toBeOnTheScreen();
  });

  it("ao voltar ao app, consulta de novo", async () => {
    const { result } = await renderHook(() => useDashboard("2026-11"), { wrapper });
    await settle();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = getSummary.mock.calls.length;

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle();

    await waitFor(() => expect(getSummary.mock.calls.length).toBeGreaterThan(before));
    queryClient.clear();
    focusManager.setFocused(undefined);
  });
});
