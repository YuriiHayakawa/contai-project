import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { today } from "../../../lib/dates";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import type { CategoryTree } from "../../categories/types";
import * as transactionsService from "../services/transactionsService";
import type { Transaction } from "../types";
import { TransactionSheet } from "./TransactionSheet";

vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");
vi.mock("../services/transactionsService");

const listAccounts = vi.mocked(accountsService.listAccounts);
const listCategories = vi.mocked(categoriesService.listCategories);
const createTransaction = vi.mocked(transactionsService.createTransaction);
const updateTransaction = vi.mocked(transactionsService.updateTransaction);
const rememberLastUsedAccount = vi.mocked(transactionsService.rememberLastUsedAccount);

const conta: Account = {
  id: "acc-conta",
  type: "checking",
  name: "Conta Nubank",
  institution: "Nubank",
  initial_balance_cents: 100000,
  initial_balance_date: "2026-01-01",
  closing_day: null,
  due_day: null,
  archived: false,
  balance_cents: 100000,
};

const categories: CategoryTree = {
  expense: [
    {
      id: "cat-outros",
      name: "Outros",
      kind: "expense",
      parent_id: null,
      icon: "shapes",
      color: "ardosia",
      is_fallback: true,
      archived: false,
      children: [],
    },
  ],
  income: [],
};

const saved: Transaction = {
  id: "tx-1",
  type: "expense",
  transfer_direction: null,
  amount_cents: 4590,
  date: "2026-09-28",
  description: "iFood",
  notes: null,
  account_id: "acc-conta",
  category_id: "cat-outros",
  transfer_group_id: null,
  installment_group_id: null,
  installment_number: null,
  installment_count: null,
  source: "manual",
  created_at: "2026-09-28T15:00:00Z",
};

interface HarnessProps {
  transaction?: Transaction;
}

function Harness({ transaction }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Lançar
      </button>
      <TransactionSheet open={open} transaction={transaction} onClose={() => setOpen(false)} />
    </>
  );
}

function renderSheet(transaction?: Transaction) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/lancamentos"]}>
          <Routes>
            <Route path="/lancamentos" element={<Harness transaction={transaction} />} />
            <Route path="/contas" element={<h1>Contas</h1>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const trigger = (): HTMLElement => screen.getByRole("button", { name: "Lançar" });

beforeEach(() => {
  vi.resetAllMocks();
  listAccounts.mockResolvedValue([conta]);
  listCategories.mockResolvedValue(categories);
  vi.mocked(transactionsService.getLastUsedAccountId).mockReturnValue(null);
});

describe("TransactionSheet", () => {
  it("carrega contas e categorias antes de abrir, e abre com o foco no valor", async () => {
    const user = renderSheet();
    await waitFor(() => expect(listCategories).toHaveBeenCalled());
    expect(listAccounts).toHaveBeenCalled();
    await waitFor(() => expect(listAccounts.mock.results[0]?.type).toBe("return"));

    await user.click(trigger());

    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    await waitFor(() =>
      expect(within(sheet).getByRole("textbox", { name: "Valor em reais" })).toHaveFocus(),
    );
  });

  it("salva o lançamento, guarda a conta usada, avisa e fecha devolvendo o foco", async () => {
    createTransaction.mockResolvedValue({ ...saved, date: today() });
    const user = renderSheet();
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    const amount = await within(sheet).findByRole("textbox", { name: "Valor em reais" });
    await waitFor(() => expect(amount).toHaveFocus());

    // O foco já está no valor: é só digitar.
    await user.keyboard("4590");
    await user.type(within(sheet).getByRole("textbox", { name: "Descrição" }), "iFood");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Categoria" }), "Outros");
    await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createTransaction).toHaveBeenCalledWith({
      type: "expense",
      amount_cents: 4590,
      date: today(),
      description: "iFood",
      account_id: "acc-conta",
      category_id: "cat-outros",
      notes: null,
    });
    expect(rememberLastUsedAccount).toHaveBeenCalledWith("acc-conta");
    expect(screen.getByRole("status")).toHaveTextContent("Lançamento salvo.");
    expect(trigger()).toHaveFocus();
  });

  it("reaberta depois de salvar, vem em branco", async () => {
    createTransaction.mockResolvedValue(saved);
    const user = renderSheet();
    await user.click(trigger());
    let sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    await user.type(await within(sheet).findByRole("textbox", { name: "Valor em reais" }), "4590");
    await user.type(within(sheet).getByRole("textbox", { name: "Descrição" }), "iFood");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Categoria" }), "Outros");
    await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(trigger());

    sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    expect(within(sheet).getByRole("textbox", { name: "Valor em reais" })).toHaveValue("0,00");
    expect(within(sheet).getByRole("textbox", { name: "Descrição" })).toHaveValue("");
  });

  it("com dados digitados, Esc não fecha a folha", async () => {
    const user = renderSheet();
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    await user.type(await within(sheet).findByRole("textbox", { name: "Descrição" }), "iFood");

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edição: envia a mudança para o lançamento certo e avisa", async () => {
    updateTransaction.mockResolvedValue({ ...saved, description: "iFood do almoço" });
    const user = renderSheet(saved);
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Editar lançamento" });
    const description = await within(sheet).findByRole("textbox", { name: "Descrição" });
    // Na edição o teclado não sobe sozinho: o foco fica na folha, e não no valor.
    expect(within(sheet).getByRole("textbox", { name: "Valor em reais" })).not.toHaveFocus();

    await user.clear(description);
    await user.type(description, "iFood do almoço");
    await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateTransaction).toHaveBeenCalledWith("tx-1", {
      type: "expense",
      amount_cents: 4590,
      date: "2026-09-28",
      description: "iFood do almoço",
      account_id: "acc-conta",
      category_id: "cat-outros",
      notes: null,
    });
    expect(createTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Lançamento atualizado.");
  });

  it("sem conta ativa, convida a cadastrar uma e leva à tela de contas", async () => {
    listAccounts.mockResolvedValue([{ ...conta, archived: true }]);
    const user = renderSheet();
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });

    expect(
      await within(sheet).findByRole("heading", { name: "Cadastre uma conta primeiro" }),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Salvar lançamento" })).toBeNull();

    await user.click(within(sheet).getByRole("button", { name: "Cadastrar conta" }));

    expect(await screen.findByRole("heading", { name: "Contas" })).toBeInTheDocument();
  });
});
