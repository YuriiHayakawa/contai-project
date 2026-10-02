import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MonthTotals } from "../types";
import { TrendChart } from "./TrendChart";

const trend: MonthTotals[] = [
  { month: "2026-04", income_cents: 480_000, expense_cents: 421_000, net_cents: 59_000 },
  { month: "2026-05", income_cents: 0, expense_cents: 0, net_cents: 0 },
  { month: "2026-06", income_cents: 530_000, expense_cents: 452_000, net_cents: 78_000 },
  { month: "2026-07", income_cents: 480_000, expense_cents: 410_500, net_cents: 69_500 },
  { month: "2026-08", income_cents: 510_000, expense_cents: 376_000, net_cents: 134_000 },
  { month: "2026-09", income_cents: 545_000, expense_cents: 397_240, net_cents: 147_760 },
];

beforeAll(() => {
  // O jsdom não mede elementos: o contêiner do Recharts só precisa conseguir observar.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("TrendChart", () => {
  it("tem legenda e um resumo em texto do que o gráfico mostra", () => {
    render(<TrendChart trend={trend} month="2026-09" onSelectMonth={vi.fn()} />);

    expect(screen.getByText("Entradas", { selector: "li" })).toBeInTheDocument();
    expect(screen.getByText("Saídas", { selector: "li" })).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Entradas e saídas de abril a setembro de 2026. " +
        "Em setembro: entradas de R$ 5.450,00 e saídas de R$ 3.972,40.",
    );
  });

  it("traz os mesmos dados em tabela, e a tabela também troca o mês", async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    render(<TrendChart trend={trend} month="2026-09" onSelectMonth={onSelectMonth} />);

    expect(screen.getByText("Ver como tabela")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { hidden: true })).getAllByRole("row", {
      hidden: true,
    });
    expect(rows.map((row) => row.textContent)).toEqual([
      "MêsEntradasSaídas",
      "AbrilR$ 4.800,00R$ 4.210,00",
      "MaioR$ 0,00R$ 0,00",
      "JunhoR$ 5.300,00R$ 4.520,00",
      "JulhoR$ 4.800,00R$ 4.105,00",
      "AgostoR$ 5.100,00R$ 3.760,00",
      "SetembroR$ 5.450,00R$ 3.972,40",
    ]);
    const september = screen.getByRole("button", { name: "Setembro", hidden: true });
    expect(september).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByText("Ver como tabela"));
    await user.click(screen.getByRole("button", { name: "Junho", hidden: true }));

    expect(onSelectMonth).toHaveBeenCalledWith("2026-06");
  });

  it("sem entradas nem saídas nos meses, mostra a frase no lugar dos eixos", () => {
    const empty = trend.map((item) => ({
      ...item,
      income_cents: 0,
      expense_cents: 0,
      net_cents: 0,
    }));
    render(<TrendChart trend={empty} month="2026-09" onSelectMonth={vi.fn()} />);

    expect(screen.getByText("Sem entradas nem saídas nestes meses.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument();
  });
});
