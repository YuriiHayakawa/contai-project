import type { InvoicePayment } from "../dashboard/types";
import type { TransactionPreset } from "./types";

interface CardToPay {
  id: string;
  name: string;
  payment: InvoicePayment;
}

/**
 * Pagamento de fatura (FR-033): uma transferência de uma conta para o cartão. Vem com o valor
 * da última fatura fechada que ainda não foi paga; sem ela, com tudo o que se deve hoje. Não é
 * despesa: as compras já contaram como gasto no mês em que foram feitas.
 */
export function invoicePaymentPreset(card: CardToPay): TransactionPreset {
  const { closed_invoice: closed, total_due_cents: totalDue } = card.payment;
  const suggested = closed?.amount_cents ?? totalDue;
  return {
    type: "transfer",
    toAccountId: card.id,
    amountCents: suggested > 0 ? suggested : undefined,
    description: `Pagamento da fatura ${card.name}`,
    invoicePayment: {
      closedInvoice: closed && { dueDate: closed.due_date, amountCents: closed.amount_cents },
      totalDueCents: totalDue,
    },
  };
}
