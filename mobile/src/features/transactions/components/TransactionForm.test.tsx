import { render, screen, userEvent } from "@testing-library/react-native";
import { today } from "@web/lib/dates";

import { accounts, categories, recent, transaction } from "../fixtures";
import { TransactionForm, type TransactionFormProps } from "./TransactionForm";

function brDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

async function renderForm(props: Partial<TransactionFormProps> = {}) {
  const onSubmit = jest.fn();
  await render(
    <TransactionForm
      accounts={accounts}
      categories={categories}
      recent={recent}
      submitLabel="Salvar lançamento"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe("formulário de lançamento", () => {
  it("já vem com a conta mais usada, a data de hoje em Brasília e Outros", async () => {
    await renderForm();

    expect(screen.getByRole("button", { name: "Conta: Inter crédito" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Categoria: Outros" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Data").props.value).toBe(brDate(today()));
    expect(screen.getByRole("radio", { name: "Despesa" })).toBeChecked();
  });

  it("sugere a categoria pela descrição e salva em poucos toques", async () => {
    const { onSubmit, user } = await renderForm();

    await user.type(screen.getByLabelText("Valor em reais"), "4590");
    await user.type(screen.getByLabelText("Descrição"), "ifood");
    expect(screen.getByRole("button", { name: "Categoria: Alimentação" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Salvar lançamento" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "expense",
      amount_cents: 4590,
      date: today(),
      description: "ifood",
      account_id: "acc-inter",
      category_id: "cat-food",
      notes: null,
    });
  });

  it("mantém a categoria escolhida à mão quando a descrição muda", async () => {
    const { user } = await renderForm();

    await user.press(screen.getByRole("button", { name: "Categoria: Outros" }));
    await user.press(screen.getByRole("radio", { name: "Transporte" }));
    await user.type(screen.getByLabelText("Descrição"), "iFood");

    expect(screen.getByRole("button", { name: "Categoria: Transporte" })).toBeOnTheScreen();
  });

  it.each([
    ["vazio", ""],
    ["zero", "000"],
  ])("valor %s mostra o erro no campo e não envia", async (_case, typed) => {
    const { onSubmit, user } = await renderForm();

    if (typed) await user.type(screen.getByLabelText("Valor em reais"), typed);
    await user.type(screen.getByLabelText("Descrição"), "Padaria");
    await user.press(screen.getByRole("button", { name: "Salvar lançamento" }));

    expect(await screen.findByText("Informe um valor maior que zero.")).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("data inválida mostra o erro no campo", async () => {
    const { onSubmit, user } = await renderForm();

    await user.type(screen.getByLabelText("Valor em reais"), "1000");
    await user.type(screen.getByLabelText("Descrição"), "Padaria");
    await user.clear(screen.getByLabelText("Data"));
    await user.type(screen.getByLabelText("Data"), "31/02/2026");
    await user.press(screen.getByRole("button", { name: "Salvar lançamento" }));

    expect(await screen.findByText("Escolha a data do lançamento.")).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Ontem troca a data", async () => {
    const { user } = await renderForm();

    await user.press(screen.getByRole("button", { name: "Ontem" }));

    const [year, month, day] = today().split("-").map(Number) as [number, number, number];
    const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
    expect(screen.getByLabelText("Data").props.value).toBe(brDate(yesterday));
  });

  it("Receita troca as categorias pelas de receita", async () => {
    const { onSubmit, user } = await renderForm();

    await user.press(screen.getByRole("radio", { name: "Receita" }));
    expect(screen.getByRole("button", { name: "Categoria: Outros" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Categoria: Outros" }));

    expect(screen.getByRole("radio", { name: "Salário" })).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: "Transporte" })).not.toBeOnTheScreen();
    await user.press(screen.getByRole("radio", { name: "Salário" }));

    await user.type(screen.getByLabelText("Valor em reais"), "500000");
    await user.type(screen.getByLabelText("Descrição"), "Salário de novembro");
    await user.press(screen.getByRole("button", { name: "Salvar lançamento" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "income", category_id: "cat-salary", amount_cents: 500000 }),
    );
  });

  it("não oferece contas arquivadas", async () => {
    const { user } = await renderForm();

    await user.press(screen.getByRole("button", { name: "Conta: Inter crédito" }));

    expect(screen.getByRole("radio", { name: "Nubank" })).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: "Conta antiga" })).not.toBeOnTheScreen();
  });

  it("na edição, vem preenchido com o lançamento", async () => {
    const editing = transaction("t9", {
      amount_cents: 4590,
      description: "iFood",
      account_id: "acc-nubank",
      category_id: "cat-market",
      date: "2026-11-03",
      notes: "Jantar",
    });
    const { onSubmit, user } = await renderForm({ transaction: editing, submitLabel: "Salvar" });

    expect(screen.getByLabelText("Valor em reais").props.value).toBe("45,90");
    expect(screen.getByRole("button", { name: "Conta: Nubank" })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Categoria: Alimentação › Mercado" }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText("Data").props.value).toBe("03/11/2026");
    await user.press(screen.getByRole("button", { name: "Salvar" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "expense",
      amount_cents: 4590,
      date: "2026-11-03",
      description: "iFood",
      account_id: "acc-nubank",
      category_id: "cat-market",
      notes: "Jantar",
    });
  });
});
