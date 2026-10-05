import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../../../lib/api-client";
import { today } from "../../../lib/dates";
import type { Account, AccountInput } from "../types";
import { AccountForm } from "./AccountForm";

const FORM_ID = "conta";

function renderForm(account?: Account) {
  const onSubmit = vi.fn<(input: AccountInput) => Promise<unknown>>().mockResolvedValue(undefined);
  render(
    <>
      <AccountForm id={FORM_ID} account={account} onSubmit={onSubmit} />
      <button type="submit" form={FORM_ID}>
        Salvar
      </button>
    </>,
  );
  return { user: userEvent.setup(), onSubmit };
}

const card: Account = {
  id: "acc-inter",
  type: "credit_card",
  name: "Inter crédito",
  institution: null,
  initial_balance_cents: -30_000,
  initial_balance_date: "2026-10-02",
  closing_day: 7,
  due_day: 14,
  credit_limit_cents: 50_000,
  archived: false,
  balance_cents: -41_000,
};

const type = (): HTMLElement => screen.getByLabelText("Tipo");
const debt = (): HTMLElement =>
  screen.getByRole("textbox", { name: "Quanto você já deve neste cartão, em reais" });
const limit = (): HTMLElement => screen.getByRole("textbox", { name: "Limite do cartão em reais" });
const save = (): HTMLElement => screen.getByRole("button", { name: "Salvar" });

async function fillCard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Nome"), "Inter crédito");
  await user.selectOptions(type(), "credit_card");
  await user.type(screen.getByLabelText("Dia do fechamento"), "7");
  await user.type(screen.getByLabelText("Dia do vencimento"), "14");
}

describe("AccountForm: cartão de crédito", () => {
  it("no cartão, o valor inicial é quanto já se deve: começa em zero e não tem caixa de dívida", async () => {
    const { user } = renderForm();

    await user.selectOptions(type(), "credit_card");

    expect(screen.getByText("Quanto você já deve neste cartão")).toBeVisible();
    expect(debt()).toHaveValue("0,00");
    expect(debt()).toHaveAccessibleDescription(/Deixe em zero se a fatura está em dia/);
    expect(screen.queryByText("Saldo inicial")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("o limite é um campo próprio, opcional, que só aparece em cartão", async () => {
    const { user } = renderForm();

    expect(screen.queryByText(/Limite do cartão/)).toBeNull();

    await user.selectOptions(type(), "credit_card");

    expect(limit()).toHaveValue("0,00");
    expect(screen.getByText(/^Limite do cartão/, { selector: "label" })).toHaveTextContent(
      "Limite do cartão (opcional)",
    );
    expect(limit()).toHaveAccessibleDescription(/É o teto do cartão, e não dinheiro seu/);
  });

  it("envia a dívida como valor negativo e o limite à parte", async () => {
    const { user, onSubmit } = renderForm();
    await fillCard(user);

    // Digitação de caixa registradora: os algarismos entram pela direita.
    await user.type(debt(), "30000");
    await user.type(limit(), "50000");
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Inter crédito",
      type: "credit_card",
      institution: null,
      initial_balance_cents: -30_000,
      initial_balance_date: today(),
      closing_day: 7,
      due_day: 14,
      credit_limit_cents: 50_000,
    });
  });

  it("cartão em dia e sem limite: dívida zero e limite vazio", async () => {
    const { user, onSubmit } = renderForm();
    await fillCard(user);

    await user.click(save());

    const [input] = onSubmit.mock.calls[0] ?? [];
    expect(input?.initial_balance_cents).toBe(0);
    expect(input?.credit_limit_cents).toBeNull();
  });

  it("ao editar, mostra a dívida sem sinal e o limite guardado", () => {
    renderForm(card);

    expect(debt()).toHaveValue("300,00");
    expect(limit()).toHaveValue("500,00");
  });

  it("zerar o limite ao editar deixa o cartão sem limite", async () => {
    const { user, onSubmit } = renderForm(card);

    await user.clear(limit());
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ initial_balance_cents: -30_000, credit_limit_cents: null }),
    );
  });

  it("a recusa do servidor aparece junto do campo do limite", async () => {
    const { user, onSubmit } = renderForm(card);
    onSubmit.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "validation_error",
        message: "Confira os campos.",
        details: { fields: { credit_limit_cents: "Informe um limite maior que zero." } },
      }),
    );

    await user.click(save());

    expect(await screen.findByText("Informe um limite maior que zero.")).toBeVisible();
    expect(limit()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("AccountForm: outras contas", () => {
  it('continuam com "Saldo inicial" e a caixa de saldo negativo, sem limite', async () => {
    const { user, onSubmit } = renderForm();
    await user.type(screen.getByLabelText("Nome"), "Conta Principal");

    expect(screen.getByText("Saldo inicial")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Saldo inicial em reais" }), "100000");
    await user.click(screen.getByRole("checkbox", { name: "O saldo está negativo" }));
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "checking",
        initial_balance_cents: -100_000,
        closing_day: null,
        due_day: null,
        credit_limit_cents: null,
      }),
    );
  });

  it("saldo positivo continua positivo", async () => {
    const { user, onSubmit } = renderForm();
    await user.type(screen.getByLabelText("Nome"), "Poupança");
    await user.type(screen.getByRole("textbox", { name: "Saldo inicial em reais" }), "100000");

    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ initial_balance_cents: 100_000, credit_limit_cents: null }),
    );
  });

  it("um valor digitado como limite não segue junto se a conta deixa de ser cartão", async () => {
    const { user, onSubmit } = renderForm();
    await fillCard(user);
    await user.type(limit(), "50000");

    await user.selectOptions(type(), "checking");
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "checking", credit_limit_cents: null }),
    );
  });
});
