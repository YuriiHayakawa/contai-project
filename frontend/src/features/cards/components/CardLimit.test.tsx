import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { CreditLimitUsage } from "../../dashboard/types";
import { CardLimit } from "./CardLimit";

function renderLimit(usage: CreditLimitUsage | null) {
  render(
    <MemoryRouter>
      <CardLimit usage={usage} />
    </MemoryRouter>,
  );
  return screen.getByRole("heading", { name: "Limite do cartão" }).closest("section");
}

const meter = (): HTMLElement => screen.getByRole("meter", { name: "Uso do limite" });
const barWidth = (): string => (meter().firstElementChild as HTMLElement).style.width;

describe("CardLimit", () => {
  it("mostra o disponível, o usado e o limite, com a barra na proporção do uso", () => {
    const card = renderLimit({ limit_cents: 50_000, used_cents: 11_000, available_cents: 39_000 });

    expect(card).toHaveTextContent("DisponívelR$ 390,00");
    expect(card).toHaveTextContent("UsadoR$ 110,00");
    expect(card).toHaveTextContent("LimiteR$ 500,00");
    expect(meter()).toHaveAttribute("aria-valuenow", "11000");
    expect(meter()).toHaveAttribute("aria-valuemax", "50000");
    expect(meter()).toHaveAttribute("aria-valuetext", "R$\u00a0110,00 usados de R$\u00a0500,00");
    expect(barWidth()).toBe("22%");
  });

  it("explica que as parcelas que ainda vêm já contam como usado", () => {
    const card = renderLimit({ limit_cents: 50_000, used_cents: 30_000, available_cents: 20_000 });

    expect(card).toHaveTextContent(
      "O usado soma o que você deve hoje e o que já está lançado para depois, como as parcelas.",
    );
  });

  it("sem nada usado, o limite inteiro está disponível e a barra fica vazia", () => {
    const card = renderLimit({ limit_cents: 50_000, used_cents: 0, available_cents: 50_000 });

    expect(card).toHaveTextContent("DisponívelR$ 500,00");
    expect(barWidth()).toBe("0%");
  });

  it("um uso pequeno ainda aparece na barra", () => {
    renderLimit({ limit_cents: 1_000_000, used_cents: 100, available_cents: 999_900 });

    expect(barWidth()).toBe("2%");
  });

  it('acima do limite, diz "R$ X acima do limite" com texto, e a barra fica cheia', () => {
    const card = renderLimit({ limit_cents: 50_000, used_cents: 60_000, available_cents: -10_000 });

    expect(card).toHaveTextContent("R$ 100,00 acima do limite");
    expect(card).not.toHaveTextContent("Disponível");
    expect(card).toHaveTextContent("UsadoR$ 600,00");
    // O leitor de tela recebe o valor dentro da faixa e o texto com o valor de verdade.
    expect(meter()).toHaveAttribute("aria-valuenow", "50000");
    expect(meter()).toHaveAttribute("aria-valuetext", "R$\u00a0600,00 usados de R$\u00a0500,00");
    expect(barWidth()).toBe("100%");
  });

  it("no limite exato, o disponível é zero, e não há alerta", () => {
    const card = renderLimit({ limit_cents: 50_000, used_cents: 50_000, available_cents: 0 });

    expect(card).toHaveTextContent("DisponívelR$ 0,00");
    expect(card).not.toHaveTextContent("acima do limite");
  });

  it("sem limite informado, convida a informá-lo em Contas", () => {
    const card = renderLimit(null);

    expect(card).toHaveTextContent(
      "Informe o limite deste cartão para ver quanto ainda dá para gastar nele.",
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("link", { name: "Informar o limite em Contas" })).toHaveAttribute(
      "href",
      "/contas",
    );
  });
});
