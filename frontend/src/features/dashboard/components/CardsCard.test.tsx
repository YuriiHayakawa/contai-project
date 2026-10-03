import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CardSummary } from "../types";
import { CardsCard } from "./CardsCard";

// O gráfico de verdade usa o Recharts; aqui basta saber o que o cartão entrega a ele.
vi.mock("./InstallmentsChart", () => ({
  InstallmentsChart: ({ months }: { months: { month: string }[] }) => (
    <p>gráfico: {months.map((item) => item.month).join(", ")}</p>
  ),
}));

const card: CardSummary = {
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

describe("CardsCard", () => {
  it("mostra a fatura atual com fechamento e vencimento, e as parcelas futuras", async () => {
    render(<CardsCard card={card} onPay={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Cartão Nubank" })).toBeInTheDocument();
    expect(screen.getByText("Fatura atual").nextElementSibling).toHaveTextContent("R$ 440,90");
    expect(screen.getByText("Fecha em 3 de out. · vence em 10 de out.")).toBeInTheDocument();
    expect(screen.getByText("Parcelas futuras").nextElementSibling).toHaveTextContent("R$ 800,00");
    expect(screen.getByText("Até a fatura de fevereiro de 2027")).toBeInTheDocument();
    expect(await screen.findByText("gráfico: 2026-11, 2027-02")).toBeInTheDocument();
  });

  it("sem parcelas pela frente, diz isso e não desenha o gráfico", () => {
    render(
      <CardsCard
        card={{ ...card, future_installments: { total_cents: 0, months: [] } }}
        onPay={vi.fn()}
      />,
    );

    expect(screen.getByText("Nenhuma compra parcelada pela frente")).toBeInTheDocument();
    expect(screen.queryByText(/^gráfico/)).not.toBeInTheDocument();
  });

  it('"Pagar fatura" abre a transferência para o cartão com a última fatura fechada', async () => {
    const user = userEvent.setup();
    const onPay = vi.fn();
    render(<CardsCard card={card} onPay={onPay} />);

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(onPay).toHaveBeenCalledWith({
      type: "transfer",
      toAccountId: "acc-cartao",
      amountCents: 30_000,
      description: "Pagamento da fatura Cartão Nubank",
      invoicePayment: {
        closedInvoice: { dueDate: "2026-09-10", amountCents: 30_000 },
        totalDueCents: 124_380,
      },
    });
  });

  it('sem fatura fechada em aberto, "Pagar fatura" sugere tudo o que se deve', async () => {
    const user = userEvent.setup();
    const onPay = vi.fn();
    render(
      <CardsCard
        card={{ ...card, payment: { closed_invoice: null, total_due_cents: 44_090 } }}
        onPay={onPay}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(onPay).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 44_090,
        invoicePayment: { closedInvoice: null, totalDueCents: 44_090 },
      }),
    );
  });
});
