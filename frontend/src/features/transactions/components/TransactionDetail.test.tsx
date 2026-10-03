import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../../components/ui/Toast";
import type { Account } from "../../accounts/types";
import * as transactionsService from "../services/transactionsService";
import type { Transaction } from "../types";
import { TransactionDetail } from "./TransactionDetail";

vi.mock("../services/transactionsService");

const listTransactions = vi.mocked(transactionsService.listTransactions);
const deleteTransaction = vi.mocked(transactionsService.deleteTransaction);

function account(id: string, name: string): Account {
  return {
    id,
    type: "checking",
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: null,
    due_day: null,
    archived: false,
    balance_cents: 0,
  };
}

const accounts = new Map(
  [account("acc-conta", "Conta corrente"), account("acc-poupanca", "Poupança")].map((item) => [
    item.id,
    item,
  ]),
);

const base: Transaction = {
  id: "tx",
  type: "expense",
  transfer_direction: null,
  amount_cents: 3_333,
  date: "2026-10-20",
  description: "Tênis",
  notes: null,
  account_id: "acc-conta",
  category_id: null,
  transfer_group_id: null,
  installment_group_id: null,
  installment_number: null,
  installment_count: null,
  source: "manual",
  created_at: "2026-10-01T12:00:00Z",
};

function renderDetail(transaction: Transaction, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TransactionDetail
          open
          transaction={transaction}
          accounts={accounts}
          onClose={onClose}
          onEdit={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  vi.resetAllMocks();
  deleteTransaction.mockResolvedValue(undefined);
});

describe("TransactionDetail: excluir parcela", () => {
  const parcels = [1, 2, 3].map((number): Transaction => ({
    ...base,
    id: `p${number}`,
    installment_group_id: "grupo",
    installment_number: number,
    installment_count: 3,
  }));

  beforeEach(() => {
    listTransactions.mockResolvedValue({ items: parcels, next_cursor: null, total_count: 3 });
  });

  it('"esta e as próximas" exclui a partir desta e diz quantas saíram', async () => {
    const { user, onClose } = renderDetail(parcels[1] as Transaction);
    expect(screen.getByText("2 de 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Excluir lançamento" }));
    const scope = await screen.findByRole("alertdialog", { name: "Excluir a parcela 2 de 3?" });
    expect(scope).toHaveTextContent("Esta e as próximas: apaga 2 parcelas, da 2 à 3.");
    await user.click(
      await within(scope).findByRole("button", { name: "Excluir esta e as próximas (2 parcelas)" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteTransaction).toHaveBeenCalledWith("p2", "following");
    expect(screen.getByRole("status")).toHaveTextContent("2 parcelas excluídas.");
  });

  it('"só esta" exclui só a parcela escolhida', async () => {
    const { user } = renderDetail(parcels[0] as Transaction);

    await user.click(screen.getByRole("button", { name: "Excluir lançamento" }));
    const scope = await screen.findByRole("alertdialog", { name: "Excluir a parcela 1 de 3?" });
    await user.click(within(scope).getByRole("button", { name: "Excluir só esta" }));

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith("p1", "single"));
  });
});

describe("TransactionDetail: transferência", () => {
  const out: Transaction = {
    ...base,
    id: "t-out",
    type: "transfer",
    transfer_direction: "out",
    amount_cents: 50_000,
    description: "Guardar",
    transfer_group_id: "grupo-t",
  };
  const received: Transaction = {
    ...out,
    id: "t-in",
    transfer_direction: "in",
    account_id: "acc-poupanca",
  };

  beforeEach(() => {
    listTransactions.mockResolvedValue({
      items: [out, received],
      next_cursor: null,
      total_count: 2,
    });
  });

  it("mostra de onde sai e para onde vai, e que não conta como gasto", async () => {
    renderDetail(received);

    expect(await screen.findByText("Conta corrente")).toBeInTheDocument();
    expect(screen.getByText("Sai de").nextElementSibling).toHaveTextContent("Conta corrente");
    expect(screen.getByText("Entra em").nextElementSibling).toHaveTextContent("Poupança");
    expect(screen.getByText(/Não conta como gasto nem como receita/)).toBeInTheDocument();
  });

  it("excluir avisa que sai das duas contas e faz um pedido só", async () => {
    const { user } = renderDetail(out);
    await screen.findByText("Poupança");

    await user.click(screen.getByRole("button", { name: "Excluir transferência" }));
    const confirm = screen.getByRole("alertdialog", { name: "Excluir esta transferência?" });
    expect(confirm).toHaveTextContent("Ela sai das duas contas, Conta corrente e Poupança");
    await user.click(within(confirm).getByRole("button", { name: "Excluir transferência" }));

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledTimes(1));
    expect(deleteTransaction).toHaveBeenCalledWith("t-out", "single");
    expect(screen.getByRole("status")).toHaveTextContent("Transferência excluída das duas contas.");
  });
});
