import type { InvoicePayment } from "../dashboard/types";
import { invoicePaymentPreset } from "./presets";

const pay = (payment: InvoicePayment) =>
  invoicePaymentPreset({ id: "acc-cartao", name: "Cartão Nubank", payment });

describe("invoicePaymentPreset", () => {
  it("sugere o que falta da última fatura fechada, com o vencimento dela", () => {
    expect(
      pay({
        closed_invoice: {
          closing_date: "2026-10-03",
          due_date: "2026-10-10",
          amount_cents: 44_090,
        },
        total_due_cents: 124_380,
      }),
    ).toEqual({
      type: "transfer",
      toAccountId: "acc-cartao",
      amountCents: 44_090,
      description: "Pagamento da fatura Cartão Nubank",
      invoicePayment: {
        closedInvoice: { dueDate: "2026-10-10", amountCents: 44_090 },
        totalDueCents: 124_380,
      },
    });
  });

  it("sem fatura fechada em aberto, sugere o total devido", () => {
    const preset = pay({ closed_invoice: null, total_due_cents: 15_089 });

    expect(preset.amountCents).toBe(15_089);
    expect(preset.invoicePayment).toEqual({ closedInvoice: null, totalDueCents: 15_089 });
  });

  it("sem dívida, deixa o valor em branco", () => {
    expect(pay({ closed_invoice: null, total_due_cents: 0 }).amountCents).toBeUndefined();
  });
});
