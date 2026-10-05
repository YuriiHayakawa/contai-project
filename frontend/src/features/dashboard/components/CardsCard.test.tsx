import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { CardSummary } from "../types";
import { CardsCard } from "./CardsCard";

const nubank: CardSummary = {
  account_id: "acc-cartao",
  name: "Cartão Nubank",
  closing_day: 3,
  due_day: 10,
  current_invoice: {
    period_start: "2026-09-03",
    period_end: "2026-10-02",
    closing_date: "2026-10-03",
    due_date: "2026-10-10",
    amount_cents: 44_090,
  },
  future_installments: {
    total_cents: 80_000,
    months: [
      { month: "2026-11", amount_cents: 40_000 },
      { month: "2027-02", amount_cents: 40_000 },
    ],
  },
  payment: {
    closed_invoice: { closing_date: "2026-09-03", due_date: "2026-09-10", amount_cents: 30_000 },
    total_due_cents: 124_380,
  },
};

const inter: CardSummary = {
  ...nubank,
  account_id: "acc-inter",
  name: "Cartão Inter",
  future_installments: { total_cents: 0, months: [] },
};

function renderCard(cards: CardSummary[]) {
  render(
    <MemoryRouter>
      <CardsCard cards={cards} />
    </MemoryRouter>,
  );
}

describe("CardsCard", () => {
  it("mostra a fatura atual, com o fechamento, e o total das parcelas futuras", () => {
    renderCard([nubank]);

    const row = screen.getByRole("link", { name: /Cartão Nubank/ });
    expect(row).toHaveTextContent("Fatura atual · fecha em 3 de out.");
    expect(row).toHaveTextContent("Parcelas futuras: R$ 800,00");
    expect(row).toHaveTextContent("R$ 440,90");
  });

  it("cada cartão leva à tela dele, e o cabeçalho, à tela de cartões", () => {
    renderCard([inter, nubank]);

    expect(screen.getByRole("link", { name: /Cartão Inter/ })).toHaveAttribute(
      "href",
      "/cartoes?cartao=acc-inter",
    );
    expect(screen.getByRole("link", { name: /Cartão Nubank/ })).toHaveAttribute(
      "href",
      "/cartoes?cartao=acc-cartao",
    );
    expect(screen.getByRole("link", { name: "Ver cartões" })).toHaveAttribute("href", "/cartoes");
  });

  it("sem parcelas pela frente, diz isso", () => {
    renderCard([inter]);

    expect(screen.getByRole("link", { name: /Cartão Inter/ })).toHaveTextContent(
      "Sem parcelas pela frente",
    );
  });
});
