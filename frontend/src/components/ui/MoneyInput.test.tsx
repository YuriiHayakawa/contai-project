import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { MoneyInput, type MoneyInputProps } from "./MoneyInput";

type HarnessProps = Partial<Pick<MoneyInputProps, "tone" | "error" | "disabled">> & {
  initial?: number;
  onCents?: (cents: number) => void;
};

function Harness({ initial = 0, onCents, ...props }: HarnessProps) {
  const [cents, setCents] = useState(initial);
  return (
    <MoneyInput
      {...props}
      value={cents}
      onChange={(next) => {
        setCents(next);
        onCents?.(next);
      }}
    />
  );
}

const field = (): HTMLInputElement => screen.getByRole("textbox", { name: "Valor em reais" });

describe("MoneyInput", () => {
  it("mostra o prefixo R$ e o campo com teclado numérico e nome acessível", () => {
    render(<Harness />);

    expect(screen.getByText("R$")).toBeInTheDocument();
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAttribute("aria-label", "Valor em reais");
    expect(field()).toHaveValue("0,00");
  });

  it("digitação de caixa registradora: 4, 5, 9, 0 mostra 0,04, 0,45, 4,59 e 45,90", async () => {
    const user = userEvent.setup();
    const onCents = vi.fn();
    render(<Harness onCents={onCents} />);

    await user.click(field());
    const shown: string[] = [];
    for (const key of ["4", "5", "9", "0"]) {
      await user.keyboard(key);
      shown.push(field().value);
    }

    expect(shown).toEqual(["0,04", "0,45", "4,59", "45,90"]);
    expect(onCents.mock.calls.map(([cents]) => cents)).toEqual([4, 45, 459, 4590]);
  });

  it("apagar remove o último algarismo", async () => {
    const user = userEvent.setup();
    render(<Harness initial={4590} />);

    await user.click(field());
    await user.keyboard("{Backspace}");
    expect(field()).toHaveValue("4,59");

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(field()).toHaveValue("0,00");
  });

  it("os algarismos entram pela direita mesmo com o cursor no começo", async () => {
    const user = userEvent.setup();
    render(<Harness initial={45} />);

    await user.click(field());
    field().setSelectionRange(0, 0);
    await user.keyboard("9");

    expect(field()).toHaveValue("4,59");
  });

  it("ignora letras e símbolos", async () => {
    const user = userEvent.setup();
    render(<Harness initial={4590} />);

    await user.click(field());
    await user.keyboard("a,.-");

    expect(field()).toHaveValue("45,90");
  });

  it.each([
    ["1.234,56", "1.234,56", 123456],
    ["1234.56", "1.234,56", 123456],
    ["R$ 45,90", "45,90", 4590],
    ["1234", "1.234,00", 123400],
  ])("colar %j mostra %j", async (pasted, shown, cents) => {
    const user = userEvent.setup();
    const onCents = vi.fn();
    render(<Harness initial={777} onCents={onCents} />);

    await user.click(field());
    await user.paste(pasted);

    expect(field()).toHaveValue(shown);
    expect(onCents).toHaveBeenLastCalledWith(cents);
  });

  it("colar texto sem valor não muda o campo", async () => {
    const user = userEvent.setup();
    const onCents = vi.fn();
    render(<Harness initial={4590} onCents={onCents} />);

    await user.click(field());
    await user.paste("abc");

    expect(field()).toHaveValue("45,90");
    expect(onCents).not.toHaveBeenCalled();
  });

  it("entrega sempre um inteiro em centavos, sem ponto flutuante", async () => {
    const user = userEvent.setup();
    const onCents = vi.fn();
    render(<Harness onCents={onCents} />);

    await user.click(field());
    await user.keyboard("1005");

    expect(onCents).toHaveBeenLastCalledWith(1005);
    expect(onCents.mock.calls.every(([cents]) => Number.isInteger(cents))).toBe(true);
    expect(field()).toHaveValue("10,05");
  });

  it("para de aceitar algarismos no limite de R$ 999.999.999,99", async () => {
    const user = userEvent.setup();
    render(<Harness initial={99_999_999_999} />);

    await user.click(field());
    await user.keyboard("1");

    expect(field()).toHaveValue("999.999.999,99");
  });

  it("liga a mensagem de erro ao campo", () => {
    render(<Harness error="Informe um valor maior que zero." />);

    expect(field()).toBeInvalid();
    expect(field()).toHaveAccessibleDescription("Informe um valor maior que zero.");
  });

  it("usa a cor de receita quando o tipo é Receita", () => {
    render(<Harness tone="income" />);

    expect(field()).toHaveClass("text-income");
  });
});
