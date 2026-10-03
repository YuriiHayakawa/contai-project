import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

import { ApiError } from "../../../lib/api-client";
import { today } from "../../../lib/dates";
import type { Account } from "../../accounts/types";
import type { Category, CategoryTree } from "../../categories/types";
import type { Transaction } from "../types";
import { TransactionForm, type TransactionSubmission } from "./TransactionForm";

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

function category(
  id: string,
  name: string,
  kind: Category["kind"],
  overrides: Partial<Category> = {},
): Category {
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
    ...overrides,
  };
}

// A API devolve as contas em ordem alfabética.
const accounts: Account[] = [
  account("acc-cartao", "Cartão Nubank", { type: "credit_card", closing_day: 3, due_day: 10 }),
  account("acc-conta", "Conta Nubank"),
  account("acc-antiga", "Poupança antiga", { type: "savings", archived: true }),
];

const categories: CategoryTree = {
  expense: [
    category("cat-alimentacao", "Alimentação", "expense", {
      children: [
        category("cat-delivery", "Delivery", "expense", { parent_id: "cat-alimentacao" }),
        category("cat-mercado", "Mercado", "expense", { parent_id: "cat-alimentacao" }),
      ],
    }),
    category("cat-clube", "Clube", "expense", { archived: true }),
    category("cat-outros", "Outros", "expense", { is_fallback: true, color: "ardosia" }),
  ],
  income: [category("cat-salario", "Salário", "income")],
};

const saved: Transaction = {
  id: "tx-1",
  type: "expense",
  transfer_direction: null,
  amount_cents: 12050,
  date: "2026-09-28",
  description: "Mensalidade do clube",
  notes: "Plano família",
  account_id: "acc-antiga",
  category_id: "cat-clube",
  transfer_group_id: null,
  installment_group_id: null,
  installment_number: null,
  installment_count: null,
  source: "manual",
  created_at: "2026-09-28T15:00:00Z",
};

type SubmitHandler = (submission: TransactionSubmission) => Promise<unknown>;

function renderForm(
  transaction?: Transaction,
  onSubmit: Mock<SubmitHandler> = vi.fn<SubmitHandler>(),
) {
  render(
    <>
      <TransactionForm
        id={FORM_ID}
        accounts={accounts}
        categories={categories}
        transaction={transaction}
        onSubmit={onSubmit}
      />
      {/* No app, o botão de salvar fica no rodapé da folha, fora do formulário. */}
      <button type="submit" form={FORM_ID}>
        Salvar lançamento
      </button>
    </>,
  );
  return { user: userEvent.setup(), onSubmit };
}

const typeOption = (name: string): HTMLElement => screen.getByRole("radio", { name });
const amountField = (): HTMLInputElement => screen.getByRole("textbox", { name: "Valor em reais" });
const descriptionField = (): HTMLElement => screen.getByRole("textbox", { name: "Descrição" });
const categoryField = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Categoria" });
const accountField = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Conta" });
const dateField = (): HTMLInputElement => screen.getByLabelText("Data");
const notesField = (): HTMLElement => screen.getByRole("textbox", { name: /Observação/ });
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "Salvar lançamento" });

const optionLabels = (select: HTMLSelectElement): string[] =>
  Array.from(select.options).map((option) => option.label);

beforeEach(() => {
  window.localStorage.clear();
});

describe("TransactionForm: lançamento novo", () => {
  it("começa como despesa, com a data de hoje e o valor zerado", () => {
    renderForm();

    expect(typeOption("Despesa")).toBeChecked();
    expect(dateField()).toHaveValue(today());
    expect(amountField()).toHaveValue("0,00");
  });

  it("a conta vem com a última usada neste aparelho", () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-conta");
    renderForm();

    expect(accountField()).toHaveValue("acc-conta");
  });

  it("sem última conta, ou com uma que não serve mais, vem a primeira conta ativa", () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-antiga");
    renderForm();

    expect(accountField()).toHaveValue("acc-cartao");
  });

  it("só oferece contas e categorias ativas, com a subcategoria junto da principal", () => {
    renderForm();

    expect(optionLabels(accountField())).toEqual(["Cartão Nubank", "Conta Nubank"]);
    expect(optionLabels(categoryField())).toEqual([
      "Escolha uma categoria",
      "Alimentação",
      "Alimentação › Delivery",
      "Alimentação › Mercado",
      "Outros",
    ]);
  });

  it("o valor digitado entra pela direita e é enviado em centavos, inteiro", async () => {
    const { user, onSubmit } = renderForm();

    await user.type(amountField(), "4590");
    expect(amountField()).toHaveValue("45,90");

    await user.type(descriptionField(), "iFood");
    await user.selectOptions(categoryField(), "cat-delivery");
    await user.click(saveButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [submission] = onSubmit.mock.calls[0] ?? [];
    if (submission?.kind !== "entry") throw new Error("o envio não foi de uma despesa");
    expect(submission.input.amount_cents).toBe(4590);
    expect(Number.isInteger(submission.input.amount_cents)).toBe(true);
  });

  it("envia a despesa com todos os campos, no formato da API", async () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-conta");
    const { user, onSubmit } = renderForm();

    await user.type(amountField(), "4590");
    await user.type(descriptionField(), "  iFood  ");
    await user.selectOptions(categoryField(), "cat-delivery");
    await user.click(saveButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "entry",
        input: {
          type: "expense",
          amount_cents: 4590,
          date: today(),
          description: "iFood",
          account_id: "acc-conta",
          category_id: "cat-delivery",
          notes: null,
        },
      }),
    );
  });

  it("receita: troca as categorias, limpa a escolhida e envia o tipo e a observação", async () => {
    const { user, onSubmit } = renderForm();
    await user.selectOptions(categoryField(), "cat-mercado");

    await user.click(typeOption("Receita"));

    expect(categoryField()).toHaveValue("");
    expect(optionLabels(categoryField())).toEqual(["Escolha uma categoria", "Salário"]);
    expect(amountField()).toHaveClass("text-income");

    await user.type(amountField(), "350000");
    await user.type(descriptionField(), "Salário de setembro");
    await user.selectOptions(categoryField(), "cat-salario");
    await user.selectOptions(accountField(), "acc-conta");
    await user.type(notesField(), "Com o adiantamento");
    await user.click(saveButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "entry",
        input: {
          type: "income",
          amount_cents: 350000,
          date: today(),
          description: "Salário de setembro",
          account_id: "acc-conta",
          category_id: "cat-salario",
          notes: "Com o adiantamento",
        },
      }),
    );
  });

  it("categoria é obrigatória: avisa no campo e não envia", async () => {
    const { user, onSubmit } = renderForm();

    await user.type(amountField(), "4590");
    await user.type(descriptionField(), "iFood");
    await user.click(saveButton());

    expect(await screen.findByText("Escolha uma categoria.")).toBeInTheDocument();
    expect(categoryField()).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("valor zero e descrição vazia: cada campo diz o que fazer", async () => {
    const { user, onSubmit } = renderForm();

    await user.selectOptions(categoryField(), "cat-outros");
    await user.click(saveButton());

    expect(await screen.findByText("Informe um valor maior que zero.")).toBeInTheDocument();
    expect(screen.getByText("Escreva o que foi, como o nome da loja.")).toBeInTheDocument();
    expect(amountField()).toBeInvalid();
    expect(descriptionField()).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("erro de um campo vindo do servidor aparece junto do campo", async () => {
    const onSubmit = vi.fn<SubmitHandler>().mockRejectedValue(
      new ApiError({
        status: 422,
        code: "validation_error",
        message: "Confira os campos destacados.",
        details: {
          fields: { category_id: "Esta categoria está arquivada. Escolha outra categoria." },
        },
      }),
    );
    const { user } = renderForm(undefined, onSubmit);

    await user.type(amountField(), "4590");
    await user.type(descriptionField(), "iFood");
    await user.selectOptions(categoryField(), "cat-delivery");
    await user.click(saveButton());

    expect(
      await screen.findByText("Esta categoria está arquivada. Escolha outra categoria."),
    ).toBeInTheDocument();
    expect(categoryField()).toBeInvalid();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falha sem campo, como a de rede, aparece no topo com o que fazer", async () => {
    const onSubmit = vi.fn<SubmitHandler>().mockRejectedValue(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    const { user } = renderForm(undefined, onSubmit);

    await user.type(amountField(), "4590");
    await user.type(descriptionField(), "iFood");
    await user.selectOptions(categoryField(), "cat-delivery");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confira sua conexão e tente de novo.",
    );
  });
});

describe("TransactionForm: edição", () => {
  it("vem com os dados do lançamento, mesmo com a conta e a categoria arquivadas", () => {
    window.localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, "acc-conta");
    renderForm(saved);

    expect(typeOption("Despesa")).toBeChecked();
    expect(amountField()).toHaveValue("120,50");
    expect(descriptionField()).toHaveValue("Mensalidade do clube");
    expect(dateField()).toHaveValue("2026-09-28");
    expect(notesField()).toHaveValue("Plano família");
    expect(accountField()).toHaveValue("acc-antiga");
    expect(optionLabels(accountField())).toContain("Poupança antiga (arquivada)");
    expect(categoryField()).toHaveValue("cat-clube");
    expect(optionLabels(categoryField())).toContain("Clube (arquivada)");
  });

  it("envia o lançamento inteiro com o que mudou; observação apagada vai como nula", async () => {
    const { user, onSubmit } = renderForm(saved);

    await user.clear(notesField());
    await user.click(amountField());
    await user.keyboard("{Backspace}{Backspace}99");
    await user.click(saveButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "entry",
        input: {
          type: "expense",
          amount_cents: 12099,
          date: "2026-09-28",
          description: "Mensalidade do clube",
          account_id: "acc-antiga",
          category_id: "cat-clube",
          notes: null,
        },
      }),
    );
  });
});

describe("TransactionForm: estorno", () => {
  const refundBox = (): HTMLElement =>
    screen.getByRole("checkbox", { name: /É o estorno de uma compra/ });
  const purchaseCategoryField = (): HTMLSelectElement =>
    screen.getByRole("combobox", { name: "Categoria da compra" });

  it("só a receita pode ser o estorno de uma compra", async () => {
    const { user } = renderForm();
    expect(screen.queryByRole("checkbox")).toBeNull();

    await user.click(typeOption("Receita"));
    expect(refundBox()).not.toBeChecked();

    await user.click(typeOption("Transferência"));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("marcado, a receita fica na categoria da compra e é enviada como receita", async () => {
    const { user, onSubmit } = renderForm();
    await user.click(typeOption("Receita"));
    await user.selectOptions(categoryField(), "cat-salario");

    await user.click(refundBox());

    // As categorias passam a ser as de despesa, e a que estava escolhida não vale mais.
    expect(purchaseCategoryField()).toHaveValue("");
    expect(optionLabels(purchaseCategoryField())).toEqual([
      "Escolha uma categoria",
      "Alimentação",
      "Alimentação › Delivery",
      "Alimentação › Mercado",
      "Outros",
    ]);
    expect(screen.getByText(/abate o gasto da categoria da compra/)).toBeInTheDocument();

    await user.type(amountField(), "5000");
    await user.type(descriptionField(), "Estorno do mercado");
    await user.selectOptions(purchaseCategoryField(), "cat-mercado");
    await user.selectOptions(accountField(), "acc-conta");
    await user.click(saveButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "entry",
        input: {
          type: "income",
          amount_cents: 5000,
          date: today(),
          description: "Estorno do mercado",
          account_id: "acc-conta",
          category_id: "cat-mercado",
          notes: null,
        },
      }),
    );
  });

  it("desmarcar volta para as categorias de receita, e trocar o tipo desmarca", async () => {
    const { user } = renderForm();
    await user.click(typeOption("Receita"));
    await user.click(refundBox());
    await user.selectOptions(purchaseCategoryField(), "cat-mercado");

    await user.click(refundBox());
    expect(optionLabels(categoryField())).toEqual(["Escolha uma categoria", "Salário"]);
    expect(categoryField()).toHaveValue("");

    await user.click(refundBox());
    await user.click(typeOption("Despesa"));
    await user.click(typeOption("Receita"));
    expect(refundBox()).not.toBeChecked();
  });

  it("um estorno em edição vem marcado, com a categoria da compra", () => {
    renderForm({ ...saved, type: "income", category_id: "cat-mercado", account_id: "acc-conta" });

    expect(refundBox()).toBeChecked();
    expect(purchaseCategoryField()).toHaveValue("cat-mercado");
  });

  it("uma receita comum em edição vem desmarcada", () => {
    renderForm({ ...saved, type: "income", category_id: "cat-salario", account_id: "acc-conta" });

    expect(refundBox()).not.toBeChecked();
    expect(categoryField()).toHaveValue("cat-salario");
  });
});
