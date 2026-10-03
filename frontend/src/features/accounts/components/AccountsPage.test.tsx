import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import { yearMonthOf } from "../../../lib/dates";
import * as categoriesService from "../../categories/services/categoriesService";
import * as dashboardService from "../../dashboard/services/dashboardService";
import type { CardSummary } from "../../dashboard/types";
import { NewTransactionProvider } from "../../transactions/hooks/useNewTransaction";
import * as accountsService from "../services/accountsService";
import type { Account } from "../types";
import { AccountsPage } from "./AccountsPage";

vi.mock("../services/accountsService");
vi.mock("../../categories/services/categoriesService");
vi.mock("../../dashboard/services/dashboardService");
vi.mock("../../transactions/services/transactionsService");

const getCards = vi.mocked(dashboardService.getCards);

function account(id: string, name: string, overrides: Partial<Account> = {}): Account {
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
    ...overrides,
  };
}

const card = account("acc-cartao", "Cartão Nubank", {
  type: "credit_card",
  closing_day: 3,
  due_day: 10,
  balance_cents: -124_380,
});

const summary: CardSummary = {
  account_id: "acc-cartao",
  name: "Cartão Nubank",
  closing_day: 3,
  due_day: 10,
  current_invoice: {
    period_start: "2026-09-03",
    period_end: "2026-10-02",
    closing_date: "2026-10-03",
    due_date: "2026-10-10",
    amount_cents: 94_380,
  },
  future_installments: { total_cents: 0, months: [] },
  payment: {
    closed_invoice: { closing_date: "2026-09-03", due_date: "2026-09-10", amount_cents: 30_000 },
    total_due_cents: 124_380,
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <NewTransactionProvider>
            <AccountsPage />
          </NewTransactionProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function openCard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("button", { name: /Cartão Nubank/ }));
  await user.click(screen.getByRole("button", { name: "Pagar fatura" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountsService.listAccounts).mockResolvedValue([
    account("acc-conta", "Conta corrente", { balance_cents: 500_000 }),
    card,
  ]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue({ expense: [], income: [] });
  getCards.mockResolvedValue({ items: [summary] });
});

describe("AccountsPage: pagar fatura", () => {
  it("abre a transferência com o que falta da última fatura fechada", async () => {
    const user = renderPage();

    await openCard(user);

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(getCards).toHaveBeenCalledWith(yearMonthOf(), expect.anything());
    expect(screen.getByRole("textbox", { name: "Valor em reais" })).toHaveValue("300,00");
    expect(screen.getByLabelText("Entra em", { selector: "select" })).toHaveValue("acc-cartao");
    expect(
      screen.getByRole("button", { name: "Pagar tudo o que devo: R$ 1.243,80" }),
    ).toBeInTheDocument();
  });

  it("se o resumo do cartão não carrega, avisa e não abre a folha", async () => {
    getCards.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    const user = renderPage();

    await openCard(user);

    expect(await screen.findByText(/Confira sua conexão e tente de novo/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Nova transferência" })).toBeNull();
  });
});
