import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import type { CardSummary } from "../../dashboard/types";
import { InvoiceDueNotice } from "./InvoiceDueNotice";

function card(name: string, payment: CardSummary["payment"]): CardSummary {
  return {
    account_id: `acc-${name.toLowerCase()}`,
    name,
    closing_day: 28,
    due_day: 10,
    current_invoice: {
      period_start: "2026-09-28",
      period_end: "2026-10-27",
      closing_date: "2026-10-28",
      due_date: "2026-11-10",
      amount_cents: 38_640,
    },
    future_installments: { total_cents: 0, months: [] },
    payment,
  };
}

const nubank = card("Nubank", {
  closed_invoice: { closing_date: "2026-09-28", due_date: "2026-10-10", amount_cents: 124_380 },
  total_due_cents: 163_020,
});
const itau = card("Itaú", { closed_invoice: null, total_due_cents: 51_230 });

function renderNotice(cards: CardSummary[], onPay = vi.fn()) {
  render(
    <MemoryRouter>
      <InvoiceDueNotice cards={cards} onPay={onPay} />
    </MemoryRouter>,
  );
  return onPay;
}

beforeEach(() => {
  // Só a data é fixada: os cliques continuam com o relógio de verdade.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InvoiceDueNotice", () => {
  it("avisa da fatura fechada, com o valor e o prazo, e leva à fatura", () => {
    renderNotice([itau, nubank]);

    const notice = screen.getByRole("region", { name: "Faturas a pagar" });
    expect(within(notice).getByRole("heading", { name: "Fatura fechada: Nubank" })).toBeVisible();
    expect(notice).toHaveTextContent("R$ 1.243,80 · vence em 5 dias, em 10 de out.");
    expect(within(notice).getByRole("link", { name: "Ver fatura: Nubank" })).toHaveAttribute(
      "href",
      "/cartoes?cartao=acc-nubank&fatura=2026-09",
    );
    // O cartão em dia não entra no aviso.
    expect(notice).not.toHaveTextContent("Itaú");
  });

  it('"Pagar fatura" abre a transferência com o que falta da fatura fechada', async () => {
    const user = userEvent.setup();
    const onPay = renderNotice([nubank]);

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(onPay).toHaveBeenCalledWith({
      type: "transfer",
      toAccountId: "acc-nubank",
      amountCents: 124_380,
      description: "Pagamento da fatura Nubank",
      invoicePayment: {
        closedInvoice: { dueDate: "2026-10-10", amountCents: 124_380 },
        totalDueCents: 163_020,
      },
    });
  });

  it("depois do vencimento, vira alerta e diz há quanto tempo venceu", () => {
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
    renderNotice([nubank]);

    expect(screen.getByRole("heading", { name: "Fatura vencida: Nubank" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Faturas a pagar" })).toHaveTextContent(
      "venceu há 3 dias, em 10 de out.",
    );
  });

  it("um aviso para cada cartão com fatura a pagar", () => {
    const inter = card("Inter", {
      closed_invoice: { closing_date: "2026-10-01", due_date: "2026-10-08", amount_cents: 9_900 },
      total_due_cents: 9_900,
    });
    renderNotice([inter, nubank]);

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["Fatura fechada: Inter", "Fatura fechada: Nubank"]);
    expect(screen.getAllByRole("button", { name: "Pagar fatura" })).toHaveLength(2);
  });

  it("sem fatura a pagar, não mostra nada", () => {
    renderNotice([itau]);

    expect(screen.queryByRole("region", { name: "Faturas a pagar" })).toBeNull();
  });
});
