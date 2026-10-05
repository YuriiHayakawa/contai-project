// Tipos das rotas de faturas de um cartão (contracts/rest-api.md). Os nomes dos campos são os
// da API.
import type { CreditLimitUsage, InvoicePayment, InvoiceSummary } from "../dashboard/types";

/**
 * Em que ponto a fatura está hoje:
 * - `paid`: fechada e sem nada a pagar;
 * - `due`: fechada, com valor a pagar e dentro do prazo;
 * - `overdue`: fechada, com valor a pagar e vencida;
 * - `open`: a atual, que ainda recebe compras;
 * - `future`: ainda não começou; só tem parcelas e compras lançadas com data futura.
 */
export type InvoiceStatus = "paid" | "due" | "overdue" | "open" | "future";

export interface CardInvoice extends InvoiceSummary {
  status: InvoiceStatus;
  /**
   * O que falta pagar desta fatura, com os pagamentos quitando primeiro as mais antigas. Na
   * última fatura fechada, o total a pagar hoje está em `payment.closed_invoice`, que soma o
   * que ficou das anteriores.
   */
  remaining_cents: number;
}

export interface CardInvoices {
  account_id: string;
  name: string;
  closing_day: number;
  due_day: number;
  /** Da mais antiga para a mais nova, sempre com a última fechada e a atual. */
  items: CardInvoice[];
  payment: InvoicePayment;
  /** O uso do limite, igual ao do resumo de cartões; `null` sem limite informado. */
  credit_limit: CreditLimitUsage | null;
}
