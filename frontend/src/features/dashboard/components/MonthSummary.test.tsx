import { render, screen } from "@testing-library/react";

import type { PeriodTotals } from "../types";
import { MonthSummary } from "./MonthSummary";

function renderSummary(totals: PeriodTotals) {
  render(<MonthSummary month="2026-10" totals={totals} />);
  return screen.getByRole("region", { name: "Entradas e saídas" });
}

describe("MonthSummary", () => {
  it("mostra as entradas e as saídas do mês, cada uma com o seu valor", () => {
    const flows = renderSummary({
      income_cents: 545_000,
      expense_cents: 397_240,
      net_cents: 147_760,
    });

    expect(flows).toHaveTextContent("EntradasR$ 5.450,00");
    expect(flows).toHaveTextContent("SaídasR$ 3.972,40");
    expect(flows).not.toHaveTextContent("a seu favor");
  });

  it("saídas negativas por estornos: sem sinal de menos, como dinheiro a favor", () => {
    // O mês só teve o estorno de uma compra do mês anterior: R$ 45,90 de volta.
    const flows = renderSummary({ income_cents: 0, expense_cents: -4_590, net_cents: 4_590 });

    expect(flows).toHaveTextContent("SaídasR$ 45,90a seu favor, de estornos");
    expect(flows).not.toHaveTextContent("−");
    expect(flows).not.toHaveTextContent("-R$");
    // A conta não muda: o saldo do mês continua sendo entradas menos saídas.
    expect(screen.getByRole("region", { name: "Saldo do mês" })).toHaveTextContent("R$45,90");
    expect(screen.getByRole("region", { name: "Saldo do mês" })).not.toHaveTextContent("−");
  });

  it("saídas zeradas não levam a explicação dos estornos", () => {
    const flows = renderSummary({ income_cents: 0, expense_cents: 0, net_cents: 0 });

    expect(flows).toHaveTextContent("SaídasR$ 0,00");
    expect(flows).not.toHaveTextContent("a seu favor");
  });
});
