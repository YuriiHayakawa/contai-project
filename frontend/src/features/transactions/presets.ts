import type { TransactionPreset } from "./types";

interface CardToPay {
  id: string;
  name: string;
  /** Saldo de hoje; negativo é o que se deve no cartão. */
  balance_cents: number;
}

/**
 * Pagamento de fatura (FR-033): uma transferência de uma conta para o cartão, já com o valor
 * devido hoje. Não é despesa: as compras já contaram como gasto no mês em que foram feitas.
 */
export function invoicePaymentPreset(card: CardToPay): TransactionPreset {
  return {
    type: "transfer",
    toAccountId: card.id,
    amountCents: card.balance_cents < 0 ? -card.balance_cents : undefined,
    description: `Pagamento da fatura ${card.name}`,
  };
}
