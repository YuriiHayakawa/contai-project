import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { addMonths, monthName, monthRange, today, yearMonthOf } from "../../../lib/dates";
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

function CurrentAddress() {
  const { pathname, search } = useLocation();
  return <p data-testid="address">{`${pathname}${search}`}</p>;
}

function renderSheet(transaction?: Transaction, address = "/lancamentos") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[address]}>
          <CurrentAddress />
          <Routes>
            <Route path="/lancamentos" element={<Harness transaction={transaction} />} />
            <Route path="/" element={<Harness transaction={transaction} />} />
            <Route path="/contas" element={<h1>Contas</h1>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Preenche e salva um lançamento novo; a data que vale é a devolvida pelo servidor. */
async function saveNewEntry(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(trigger());
  const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
  await user.type(await within(sheet).findByRole("textbox", { name: "Valor em reais" }), "4590");
  await user.type(within(sheet).getByRole("textbox", { name: "Descrição" }), "iFood");
  await user.selectOptions(within(sheet).getByRole("combobox", { name: "Categoria" }), "Outros");
  await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
    updateTransaction.mockResolvedValue([{ ...saved, description: "iFood do almoço" }]);
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
    // Só o que mudou vai para o servidor.
    expect(updateTransaction).toHaveBeenCalledWith(
      "tx-1",
      { description: "iFood do almoço" },
      "single",
    );
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

  describe("data fora do mês exibido", () => {
    // Dois meses atrás: sempre fora do mês atual, em qualquer dia em que o teste rode.
    const otherMonth = addMonths(yearMonthOf(), -2);
    const otherDate = `${otherMonth}-15`;
    const range = monthRange(otherMonth);

    it("o aviso diz em que mês o lançamento ficou e leva até ele", async () => {
      createTransaction.mockResolvedValue({ ...saved, date: otherDate });
      const user = renderSheet();

      await saveNewEntry(user);

      expect(screen.getByRole("status")).toHaveTextContent(
        `Lançamento salvo em ${monthName(otherMonth)}`,
      );
      await user.click(screen.getByRole("button", { name: `Ver ${monthName(otherMonth)}` }));

      expect(screen.getByTestId("address")).toHaveTextContent(
        `/lancamentos?de=${range.from}&ate=${range.to}`,
      );
    });

    it("fora da tela de lançamentos, o mês exibido é o atual", async () => {
      createTransaction.mockResolvedValue({ ...saved, date: otherDate });
      const user = renderSheet(undefined, "/");

      await saveNewEntry(user);

      expect(
        screen.getByRole("button", { name: `Ver ${monthName(otherMonth)}` }),
      ).toBeInTheDocument();
    });

    it("com a lista já nesse mês, ou em todo o período, o aviso é o de sempre", async () => {
      createTransaction.mockResolvedValue({ ...saved, date: otherDate });
      const user = renderSheet(undefined, `/lancamentos?de=${range.from}&ate=${range.to}`);

      await saveNewEntry(user);

      expect(screen.getByRole("status")).toHaveTextContent(/^Lançamento salvo\.$/);
      expect(screen.queryByRole("button", { name: /^Ver / })).not.toBeInTheDocument();
    });

    it("data de hoje com a lista em outro mês também avisa", async () => {
      createTransaction.mockResolvedValue({ ...saved, date: today() });
      const user = renderSheet(undefined, `/lancamentos?de=${range.from}&ate=${range.to}`);

      await saveNewEntry(user);

      expect(
        screen.getByRole("button", { name: `Ver ${monthName(yearMonthOf())}` }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: `Ver ${monthName(yearMonthOf())}` }));
      expect(screen.getByTestId("address")).toHaveTextContent(/^\/lancamentos$/);
    });

    it("edição que muda a data para outro mês avisa onde o lançamento está", async () => {
      updateTransaction.mockResolvedValue([{ ...saved, date: otherDate }]);
      const user = renderSheet(saved);
      await user.click(trigger());
      const sheet = await screen.findByRole("dialog", { name: "Editar lançamento" });
      await within(sheet).findByRole("textbox", { name: "Descrição" });
      const dateField = within(sheet).getByLabelText("Data");
      await user.clear(dateField);
      await user.type(dateField, otherDate);

      await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("status")).toHaveTextContent(
        `Lançamento atualizado. Agora ele está em ${monthName(otherMonth)}`,
      );
    });
  });
});

describe("TransactionSheet: parcela", () => {
  const parcel = (number: number): Transaction => ({
    ...saved,
    id: `p${number}`,
    amount_cents: number === 1 ? 3_334 : 3_333,
    date: `2026-${String(8 + number).padStart(2, "0")}-20`,
    description: "Tênis",
    installment_group_id: "grupo",
    installment_number: number,
    installment_count: 4,
  });
  const parcels = [1, 2, 3, 4].map(parcel);
  const second = parcel(2);
  const last = parcel(4);

  beforeEach(() => {
    vi.mocked(transactionsService.listTransactions).mockResolvedValue({
      items: parcels,
      next_cursor: null,
      total_count: 4,
    });
  });

  async function editDescription(user: ReturnType<typeof userEvent.setup>) {
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Editar parcela 2 de 4" });
    const description = await within(sheet).findByRole("textbox", { name: "Descrição" });
    await user.clear(description);
    await user.type(description, "Tênis de corrida");
    await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));
    return screen.findByRole("dialog", { name: "Salvar a parcela 2 de 4" });
  }

  it("pergunta o alcance, mostrando quantas parcelas cada escolha muda", async () => {
    const user = renderSheet(second);

    const scope = await editDescription(user);

    expect(scope).toHaveTextContent("Só esta: muda apenas a parcela 2.");
    expect(scope).toHaveTextContent("Esta e as próximas: muda 3 parcelas, da 2 à 4.");
    expect(within(scope).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('"esta e as próximas" envia só o que mudou, com o alcance', async () => {
    updateTransaction.mockResolvedValue(
      parcels.slice(1).map((item) => ({ ...item, description: "Tênis de corrida" })),
    );
    const user = renderSheet(second);
    const scope = await editDescription(user);

    await user.click(
      within(scope).getByRole("button", { name: "Salvar nesta e nas próximas (3 parcelas)" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // O valor não vai junto: cada parcela guarda o dela (a primeira tem os centavos a mais).
    expect(updateTransaction).toHaveBeenCalledWith(
      "p2",
      { description: "Tênis de corrida" },
      "following",
    );
    expect(screen.getByRole("status")).toHaveTextContent("3 parcelas atualizadas.");
  });

  it('"só nesta" muda só a parcela escolhida', async () => {
    updateTransaction.mockResolvedValue([{ ...second, description: "Tênis de corrida" }]);
    const user = renderSheet(second);
    const scope = await editDescription(user);

    await user.click(within(scope).getByRole("button", { name: "Salvar só nesta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateTransaction).toHaveBeenCalledWith(
      "p2",
      { description: "Tênis de corrida" },
      "single",
    );
  });

  it("cancelar a escolha não salva nada e mantém a edição aberta", async () => {
    const user = renderSheet(second);
    const scope = await editDescription(user);

    await user.click(within(scope).getByRole("button", { name: "Cancelar" }));

    expect(updateTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Editar parcela 2 de 4" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Descrição" })).toHaveValue("Tênis de corrida");
  });

  it("a última parcela não pergunta: só ela pode mudar", async () => {
    updateTransaction.mockResolvedValue([{ ...last, description: "Tênis de corrida" }]);
    const user = renderSheet(last);
    await user.click(trigger());
    const sheet = await screen.findByRole("dialog", { name: "Editar parcela 4 de 4" });
    const description = await within(sheet).findByRole("textbox", { name: "Descrição" });
    await user.clear(description);
    await user.type(description, "Tênis de corrida");

    await user.click(within(sheet).getByRole("button", { name: "Salvar lançamento" }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction).toHaveBeenCalledWith(
      "p4",
      { description: "Tênis de corrida" },
      "single",
    );
  });
});
