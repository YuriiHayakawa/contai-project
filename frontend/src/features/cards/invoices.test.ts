import type { InvoicePayment } from "../dashboard/types";
import {
  amountToPay,
  cardStanding,
  closingLabel,
  dueLabel,
  initialInvoice,
  invoiceKey,
  invoiceMonth,
  invoiceTabLabel,
  statusLabel,
} from "./invoices";
import type { CardInvoice, InvoiceStatus } from "./types";

const TODAY = "2026-10-05";

/** Fatura de um cartão que fecha no dia 28 e vence no dia 10 do mês seguinte. */
function invoice(
  closing: string,
  due: string,
  status: InvoiceStatus,
  fields: Partial<CardInvoice> = {},
): CardInvoice {
  return {
    period_start: "2026-01-01",
    period_end: "2026-01-02",
    closing_date: closing,
    due_date: due,
    amount_cents: 10_000,
    status,
    remaining_cents: 0,
    ...fields,
  };
}

const september = invoice("2026-08-28", "2026-09-10", "paid");
const october = invoice("2026-09-28", "2026-10-10", "due", { remaining_cents: 10_000 });
const november = invoice("2026-10-28", "2026-11-10", "open");
const january = invoice("2026-12-28", "2027-01-10", "future");

describe("nome da fatura", () => {
  it("leva o mês do vencimento, e não o do fechamento", () => {
    expect(invoiceMonth(october, TODAY)).toBe("outubro");
    expect(invoiceTabLabel(october, "long", TODAY)).toBe("Outubro");
    expect(invoiceTabLabel(october, "short", TODAY)).toBe("Out");
  });

  it("em outro ano, o ano entra no nome", () => {
    expect(invoiceMonth(january, TODAY)).toBe("janeiro de 2027");
    expect(invoiceTabLabel(january, "long", TODAY)).toBe("Jan. 2027");
    expect(invoiceTabLabel(january, "short", TODAY)).toBe("Jan/27");
  });

  it("é identificada pelo mês em que fecha", () => {
    expect(invoiceKey(october)).toBe("2026-09");
  });
});

describe("statusLabel", () => {
  it("diz o estado da fatura", () => {
    expect([september, october, november, january].map(statusLabel)).toEqual([
      "Paga",
      "A pagar",
      "Aberta",
      "Futura",
    ]);
    expect(statusLabel(invoice("2026-07-28", "2026-08-10", "overdue"))).toBe("Vencida");
  });

  it("fatura fechada sem compras não aparece como paga", () => {
    expect(statusLabel({ ...september, amount_cents: 0 })).toBe("Sem compras");
  });
});

describe("initialInvoice", () => {
  it("abre na fatura a pagar, que é a que pede uma ação", () => {
    expect(initialInvoice([september, october, november, january])).toBe(october);
  });

  it("com mais de uma a pagar, abre na mais nova", () => {
    const august = invoice("2026-07-28", "2026-08-10", "overdue", { remaining_cents: 5_000 });

    expect(initialInvoice([august, october, november])).toBe(october);
  });

  it("sem nada a pagar, abre na atual", () => {
    expect(initialInvoice([september, { ...october, status: "paid" }, november, january])).toBe(
      november,
    );
  });

  it("sem faturas, não escolhe nenhuma", () => {
    expect(initialInvoice([])).toBeUndefined();
  });
});

describe("prazos", () => {
  it("diz em quantos dias a fatura vence", () => {
    expect(dueLabel("2026-10-10", TODAY)).toBe("vence em 5 dias");
    expect(dueLabel("2026-10-06", TODAY)).toBe("vence amanhã");
    expect(dueLabel("2026-10-05", TODAY)).toBe("vence hoje");
  });

  it("diz há quantos dias ela venceu", () => {
    expect(dueLabel("2026-10-04", TODAY)).toBe("venceu ontem");
    expect(dueLabel("2026-09-10", TODAY)).toBe("venceu há 25 dias");
  });

  it("diz em quantos dias a fatura aberta fecha", () => {
    expect(closingLabel("2026-10-28", TODAY)).toBe("fecha em 23 dias");
    expect(closingLabel("2026-10-06", TODAY)).toBe("fecha amanhã");
  });
});

describe("amountToPay", () => {
  const payment: InvoicePayment = {
    closed_invoice: { closing_date: "2026-09-28", due_date: "2026-10-10", amount_cents: 13_000 },
    total_due_cents: 20_000,
  };

  it("na última fatura fechada, é tudo o que se deve das fechadas", () => {
    expect(amountToPay(october, payment)).toBe(13_000);
  });

  it("em uma fatura mais antiga, é a parte que ficou dela", () => {
    const august = invoice("2026-07-28", "2026-08-10", "overdue", { remaining_cents: 3_000 });

    expect(amountToPay(august, payment)).toBe(3_000);
  });
});

describe("cardStanding", () => {
  const closed = { closing_date: "2026-09-28", amount_cents: 10_000 };

  it("em dia, com fatura a pagar ou com fatura vencida", () => {
    expect(cardStanding({ closed_invoice: null, total_due_cents: 5_000 }, TODAY)).toBe("clear");
    expect(
      cardStanding(
        { closed_invoice: { ...closed, due_date: "2026-10-05" }, total_due_cents: 10_000 },
        TODAY,
      ),
    ).toBe("due");
    expect(
      cardStanding(
        { closed_invoice: { ...closed, due_date: "2026-10-04" }, total_due_cents: 10_000 },
        TODAY,
      ),
    ).toBe("overdue");
  });
});
