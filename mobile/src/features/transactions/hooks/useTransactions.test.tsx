import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { createTestQueryClient } from "@/test-utils";

import { EditTransaction } from "../components/EditTransaction";
import { accounts, categories, recent, transaction } from "../fixtures";
import * as service from "../services/transactions";
import { useDeleteTransaction } from "./useDeleteTransaction";
import { useSaveTransaction } from "./useSaveTransaction";
import { useTransactions } from "./useTransactions";

jest.mock("../services/transactions");

const listTransactions = jest.mocked(service.listTransactions);
const createTransaction = jest.mocked(service.createTransaction);
const updateTransaction = jest.mocked(service.updateTransaction);
const deleteTransaction = jest.mocked(service.deleteTransaction);

function setup() {
  const queryClient = createTestQueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { wrapper, invalidate };
}

function invalidatedKeys(invalidate: jest.SpyInstance): unknown[] {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
}

const INPUT = {
  type: "expense" as const,
  amount_cents: 4590,
  date: "2026-11-18",
  description: "iFood",
  account_id: "acc-inter",
  category_id: "cat-food",
  notes: null,
};

beforeEach(() => {
  // Só os mocks do serviço: os do jest.setup (Keychain e área segura) continuam valendo.
  [listTransactions, createTransaction, updateTransaction, deleteTransaction].forEach((mock) =>
    mock.mockReset(),
  );
});

describe("lançamentos do mês", () => {
  it("pede o mês inteiro e mantém a ordem da API, da mais recente para a mais antiga", async () => {
    const items = [
      transaction("t-18", { date: "2026-11-18" }),
      transaction("t-10", { date: "2026-11-10" }),
      transaction("t-02", { date: "2026-11-02" }),
    ];
    listTransactions.mockResolvedValue({ items, next_cursor: null, total_count: 3 });
    const { wrapper } = setup();

    const { result } = await renderHook(() => useTransactions("2026-11"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.items.map((item) => item.id)).toEqual(["t-18", "t-10", "t-02"]);
    expect(listTransactions).toHaveBeenCalledWith(
      { from: "2026-11-01", to: "2026-11-30" },
      null,
      expect.anything(),
    );
  });

  it("troca de mês faz uma consulta nova, e o filtro de categoria vai junto", async () => {
    listTransactions.mockResolvedValue({ items: [], next_cursor: null, total_count: 0 });
    const { wrapper } = setup();

    const { result, rerender } = await renderHook(
      ({ month }: { month: string }) => useTransactions(month, "cat-food"),
      { wrapper, initialProps: { month: "2026-11" } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await rerender({ month: "2026-10" });

    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith(
        { from: "2026-10-01", to: "2026-10-31", category_id: "cat-food" },
        null,
        expect.anything(),
      ),
    );
  });

  it("criar e editar atualizam a lista e o painel", async () => {
    createTransaction.mockResolvedValue(transaction("novo"));
    updateTransaction.mockResolvedValue(transaction("t1"));
    const { wrapper, invalidate } = setup();
    const { result } = await renderHook(() => useSaveTransaction(), { wrapper });

    await act(() => result.current.mutateAsync({ input: INPUT }));
    expect(createTransaction).toHaveBeenCalledWith(INPUT);
    await act(() => result.current.mutateAsync({ id: "t1", input: INPUT }));
    expect(updateTransaction).toHaveBeenCalledWith("t1", INPUT);

    expect(invalidatedKeys(invalidate)).toEqual([
      ["transactions"],
      ["dashboard"],
      ["transactions"],
      ["dashboard"],
    ]);
  });

  it("excluir atualiza a lista e o painel", async () => {
    deleteTransaction.mockResolvedValue(undefined);
    const { wrapper, invalidate } = setup();
    const { result } = await renderHook(() => useDeleteTransaction(), { wrapper });

    await act(() => result.current.mutateAsync("t1"));

    expect(deleteTransaction).toHaveBeenCalledWith("t1");
    expect(invalidatedKeys(invalidate)).toEqual([["transactions"], ["dashboard"]]);
  });

  it("só exclui depois da confirmação", async () => {
    deleteTransaction.mockResolvedValue(undefined);
    const onDone = jest.fn();
    const { wrapper } = setup();
    await render(
      <EditTransaction
        transaction={transaction("t1", { description: "iFood" })}
        accounts={accounts}
        categories={categories}
        recent={recent}
        onDone={onDone}
      />,
      { wrapper },
    );
    const user = userEvent.setup();

    await user.press(screen.getByRole("button", { name: "Excluir lançamento" }));
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "Excluir este lançamento?" })).toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(deleteTransaction).not.toHaveBeenCalled();

    await user.press(screen.getByRole("button", { name: "Excluir lançamento" }));
    await user.press(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("deleted"));
  });
});
