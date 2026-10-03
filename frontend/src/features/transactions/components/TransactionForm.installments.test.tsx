import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

import {
  addDays,
  addMonthsToDate,
  monthLabel,
  shortDate,
  today,
  yearMonthOf,
} from "../../../lib/dates";
import type { Account } from "../../accounts/types";
import type { Category, CategoryTree } from "../../categories/types";
import type { Transaction, TransactionPreset } from "../types";
import { TransactionForm, type TransactionSubmission } from "./TransactionForm";

type SubmitHandler = (submission: TransactionSubmission) => Promise<unknown>;

const LAST_ACCOUNT_STORAGE_KEY = "contai-last-account";
const FORM_ID = "lancamento";

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

function category(id: string, name: string, kind: Category["kind"]): Category {
  return {
    id,
    name,
    kind,
    parent_id: null,
    icon: "shapes",
    color: "tinta",
    is_fallback: false,
    archived: false,
    children: [],
  };
}

const accounts: Account[] = [
  account("acc-cartao", "Cartão Nubank", { type: "credit_card", closing_day: 3, due_day: 10 }),
  account("acc-conta", "Conta corrente"),
  account("acc-poupanca", "Poupança", { type: "savings" }),
];

const categories: CategoryTree = {
  expense: [category("cat-compras", "Compras", "expense")],
  income: [category("cat-salario", "Salário", "income")],
};

function renderForm(
  options: { transaction?: Transaction; preset?: TransactionPreset } = {},
  onSubmit: Mock<SubmitHandler> = vi.fn<SubmitHandler>(),
) {
  render(
    <>
      <TransactionForm
        id={FORM_ID}
        accounts={accounts}
        categories={categories}
        transaction={options.transaction}
        transferAccounts={
          options.transaction?.type === "transfer"
            ? { fromAccountId: "acc-conta", toAccountId: "acc-poupanca" }
            : undefined
        }
        preset={options.preset}
        onSubmit={onSubmit}
      />
      <button type="submit" form={FORM_ID}>
        Salvar
      </button>
    </>,
  );
  return { user: userEvent.setup(), onSubmit };
}

/** O "Pagar fatura" do Cartão Nubank, que deve R$ 1.243,80 no total. */
function payInvoice(
  closed: { amountCents: number; dueDate: string } = {
    amountCents: 44_090,
    dueDate: addDays(today(), 8),
  },
): TransactionPreset {
  return {
    type: "transfer",
    toAccountId: "acc-cartao",
    amountCents: closed.amountCents,
    description: "Pagamento da fatura Cartão Nubank",
    invoicePayment: { closedInvoice: closed, totalDueCents: 124_380 },
  };
}

const amountField = (): HTMLInputElement => screen.getByRole("textbox", { name: "Valor em reais" });
const field = (name: string): HTMLInputElement | HTMLSelectElement =>
  screen.getByLabelText(name, { selector: "input, select" });
const installmentsField = (): HTMLSelectElement | null =>
  screen.queryByRole("combobox", { name: /^Parcelas/ });
const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Salvar" }));

beforeEach(() => {
  window.localStorage.clear();
});

describe("TransactionForm: compra parcelada", () => {
  it("só aparece em despesa nova no cartão de crédito", async () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-conta");
    const { user } = renderForm();
    expect(installmentsField()).toBeNull();

    await user.selectOptions(field("Conta"), "acc-cartao");
    expect(installmentsField()).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Receita" }));
    expect(installmentsField()).toBeNull();
  });

  it("oferece à vista e de 2 a 48 parcelas", () => {
    renderForm();

    const options = Array.from(installmentsField()?.options ?? []).map((option) => option.label);
    expect(options[0]).toBe("À vista");
    expect(options.slice(1)).toEqual(Array.from({ length: 47 }, (_, index) => `${index + 2}x`));
  });

  it("a prévia mostra cada parcela, com a diferença de centavos na primeira", async () => {
    const { user } = renderForm();

    await user.type(amountField(), "10000");
    await user.selectOptions(installmentsField() as HTMLSelectElement, "3");

    expect(screen.getByText("Valor total da compra")).toBeInTheDocument();
    const preview = screen.getByRole("list", { name: "Parcelas" });
    const months = [0, 1, 2].map((index) =>
      monthLabel(yearMonthOf(addMonthsToDate(today(), index))),
    );
    expect(
      within(preview)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      `1ª · ${months[0]}R$\u00a033,34`,
      `2ª · ${months[1]}R$\u00a033,33`,
      `3ª · ${months[2]}R$\u00a033,33`,
    ]);
    expect(preview.previousElementSibling).toHaveTextContent(
      // O toHaveTextContent troca o espaço não separável por espaço comum.
      "3 parcelas de R$ 33,33, com R$ 0,01 a mais na 1ª. Total: R$ 100,00.",
    );
  });

  it("parcela em dia que o mês não tem cai no último dia, e a prévia mostra o mês certo", async () => {
    const { user } = renderForm();
    await user.type(amountField(), "40000");
    await user.selectOptions(installmentsField() as HTMLSelectElement, "4");
    const date = field("Data da compra") as HTMLInputElement;

    await user.clear(date);
    await user.type(date, "2026-01-31");

    const rows = within(screen.getByRole("list", { name: "Parcelas" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.split("R$")[0])).toEqual([
      "1ª · Janeiro de 2026",
      "2ª · Fevereiro de 2026",
      "3ª · Março de 2026",
      "4ª · Abril de 2026",
    ]);
  });

  it("envia a compra parcelada com o total e o número de parcelas", async () => {
    const { user, onSubmit } = renderForm();

    await user.type(amountField(), "10000");
    await user.type(field("Descrição"), "Tênis de corrida");
    await user.selectOptions(field("Categoria"), "cat-compras");
    await user.selectOptions(installmentsField() as HTMLSelectElement, "3");
    await save(user);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "installments",
        input: {
          total_cents: 10_000,
          installments: 3,
          date: today(),
          description: "Tênis de corrida",
          account_id: "acc-cartao",
          category_id: "cat-compras",
          notes: null,
        },
      }),
    );
  });

  it("valor menor que um centavo por parcela é recusado antes de enviar", async () => {
    const { user, onSubmit } = renderForm();

    await user.type(amountField(), "2");
    await user.type(field("Descrição"), "Chiclete");
    await user.selectOptions(field("Categoria"), "cat-compras");
    await user.selectOptions(installmentsField() as HTMLSelectElement, "3");
    await save(user);

    expect(
      await screen.findByText("O valor total precisa dar pelo menos R$ 0,01 em cada parcela."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trocar para uma conta que não é cartão volta para à vista", async () => {
    const { user, onSubmit } = renderForm();
    await user.selectOptions(installmentsField() as HTMLSelectElement, "6");

    await user.selectOptions(field("Conta"), "acc-conta");
    await user.type(amountField(), "10000");
    await user.type(field("Descrição"), "Mercado");
    await user.selectOptions(field("Categoria"), "cat-compras");
    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].kind).toBe("entry");
  });
});

describe("TransactionForm: transferência", () => {
  it("diz de onde sai e para onde vai o dinheiro, e que não conta como gasto", async () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-cartao");
    const { user } = renderForm();

    await user.click(screen.getByRole("radio", { name: "Transferência" }));

    expect(screen.getByText(/não conta como gasto nem como receita/)).toBeInTheDocument();
    expect(field("Descrição")).toHaveValue("Transferência");
    // Por padrão o dinheiro sai de uma conta que não é cartão.
    expect(field("Sai de")).toHaveValue("acc-conta");
    expect(screen.queryByRole("combobox", { name: "Categoria" })).toBeNull();

    await user.type(amountField(), "50000");
    await user.selectOptions(field("Entra em"), "acc-poupanca");

    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "P" &&
          element.textContent === "R$\u00a0500,00 saem de Conta corrente e entram em Poupança.",
        ),
      ),
    ).toBeInTheDocument();
  });

  it("envia a transferência com as duas contas", async () => {
    const { user, onSubmit } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Transferência" }));

    await user.type(amountField(), "50000");
    await user.selectOptions(field("Entra em"), "acc-poupanca");
    await save(user);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "transfer",
        input: {
          from_account_id: "acc-conta",
          to_account_id: "acc-poupanca",
          amount_cents: 50_000,
          date: today(),
          description: "Transferência",
          notes: null,
        },
      }),
    );
  });

  it("a mesma conta nas duas pontas é recusada", async () => {
    const { user, onSubmit } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Transferência" }));

    await user.type(amountField(), "1000");
    await user.selectOptions(field("Entra em"), "acc-conta");
    await save(user);

    expect(
      await screen.findByText("Escolha duas contas diferentes: a de origem e a de destino."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('o "Pagar fatura" chega preenchido: da conta para o cartão, com a fatura fechada', () => {
    renderForm({ preset: payInvoice() });

    expect(screen.getByRole("radio", { name: "Transferência" })).toBeChecked();
    expect(amountField()).toHaveValue("440,90");
    expect(field("Sai de")).toHaveValue("acc-conta");
    expect(field("Entra em")).toHaveValue("acc-cartao");
    expect(field("Descrição")).toHaveValue("Pagamento da fatura Cartão Nubank");
    expect(screen.getByText(`Vence em ${shortDate(addDays(today(), 8))}`)).toBeInTheDocument();
    expect(screen.getByText(/^Fatura fechada: falta pagar/)).toHaveTextContent(
      "Fatura fechada: falta pagar R$ 440,90",
    );
  });

  it("fatura fechada já vencida diz que venceu", () => {
    renderForm({ preset: payInvoice({ amountCents: 44_090, dueDate: addDays(today(), -2) }) });

    expect(screen.getByText(`Venceu em ${shortDate(addDays(today(), -2))}`)).toBeInTheDocument();
  });

  it('"Pagar tudo o que devo" troca o valor pelo total em um toque, e dá para voltar', async () => {
    const { user, onSubmit } = renderForm({ preset: payInvoice() });

    await user.click(screen.getByRole("button", { name: "Pagar tudo o que devo: R$ 1.243,80" }));

    expect(amountField()).toHaveValue("1.243,80");
    await save(user);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transfer",
        input: expect.objectContaining({ to_account_id: "acc-cartao", amount_cents: 124_380 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Pagar só a fatura fechada: R$ 440,90" }));
    expect(amountField()).toHaveValue("440,90");
  });

  it("quando a fatura fechada é tudo o que se deve, não oferece pagar tudo", () => {
    renderForm({ preset: payInvoice({ amountCents: 124_380, dueDate: addDays(today(), 8) }) });

    expect(screen.queryByRole("button", { name: /^Pagar tudo/ })).toBeNull();
  });

  it("sem fatura fechada em aberto, sugere o total e explica que a atual não fechou", () => {
    renderForm({
      preset: {
        ...payInvoice(),
        amountCents: 124_380,
        invoicePayment: { closedInvoice: null, totalDueCents: 124_380 },
      },
    });

    expect(amountField()).toHaveValue("1.243,80");
    expect(
      screen.getByText(
        "A fatura atual ainda não fechou. O valor é tudo o que você deve hoje neste cartão.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pagar tudo/ })).toBeNull();
  });

  it("sem nada a pagar, diz isso e deixa o valor zerado", () => {
    renderForm({
      preset: {
        ...payInvoice(),
        amountCents: undefined,
        invoicePayment: { closedInvoice: null, totalDueCents: 0 },
      },
    });

    expect(amountField()).toHaveValue("0,00");
    expect(screen.getByText("Você não deve nada neste cartão hoje.")).toBeInTheDocument();
  });

  it("o aviso da fatura sai quando o destino deixa de ser o cartão", async () => {
    const { user } = renderForm({ preset: payInvoice() });

    await user.selectOptions(field("Entra em"), "acc-poupanca");

    expect(screen.queryByText(/^Fatura fechada/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pagar tudo/ })).toBeNull();
  });

  it("na edição, as contas aparecem e não mudam; valor e data podem mudar", () => {
    renderForm({
      transaction: {
        id: "tx-out",
        type: "transfer",
        transfer_direction: "out",
        amount_cents: 50_000,
        date: "2026-09-15",
        description: "Guardar",
        notes: null,
        account_id: "acc-conta",
        category_id: null,
        transfer_group_id: "grupo",
        installment_group_id: null,
        installment_number: null,
        installment_count: null,
        source: "manual",
        created_at: "2026-09-15T12:00:00Z",
      },
    });

    expect(screen.queryByRole("radio")).toBeNull();
    expect(field("Sai de")).toHaveValue("acc-conta");
    expect(field("Sai de")).toBeDisabled();
    expect(field("Entra em")).toHaveValue("acc-poupanca");
    expect(amountField()).toBeEnabled();
  });
});
