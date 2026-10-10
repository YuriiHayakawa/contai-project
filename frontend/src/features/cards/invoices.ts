// Como a tela fala de uma fatura: o nome, o prazo e o que falta pagar. Só texto e contas com
// inteiros; o estado de cada fatura vem pronto do servidor.
import {
  daysBetween,
  monthName,
  today,
  yearMonthOf,
  type ISODate,
  type YearMonth,
} from "../../lib/dates";
import type { InvoicePayment, InvoiceSummary } from "../dashboard/types";
import type { CardInvoice, InvoiceStatus } from "./types";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paga",
  due: "A pagar",
  overdue: "Vencida",
  open: "Aberta",
  paid_ahead: "Paga",
  future: "Futura",
};

/** A fatura atual do cartão: a que ainda recebe compras, paga adiantado ou não. */
export function isCurrent(invoice: CardInvoice): boolean {
  return invoice.status === "open" || invoice.status === "paid_ahead";
}

/** O mês em que a fatura fecha: é o que a identifica no endereço e na API. */
export function invoiceKey(invoice: InvoiceSummary): YearMonth {
  return yearMonthOf(invoice.closing_date);
}

/**
 * A fatura leva o nome do mês em que vence, como no banco: "outubro", ou "janeiro de 2027"
 * quando o ano não é o de hoje.
 */
export function invoiceMonth(invoice: InvoiceSummary, reference: ISODate = today()): string {
  const month = yearMonthOf(invoice.due_date);
  const year = month.slice(0, 4);
  return year === reference.slice(0, 4) ? monthName(month) : `${monthName(month)} de ${year}`;
}

/**
 * Nome da fatura na aba: "Outubro", ou "Jan. 2027" em outro ano. No celular cabem três abas
 * estreitas, e o nome encurta (`short`): "Out", ou "Jan/27".
 */
export function invoiceTabLabel(
  invoice: InvoiceSummary,
  format: "long" | "short" = "long",
  reference: ISODate = today(),
): string {
  const month = yearMonthOf(invoice.due_date);
  const year = month.slice(0, 4);
  const sameYear = year === reference.slice(0, 4);
  const short = monthName(month, "short");
  let name: string;
  if (format === "short") name = sameYear ? short : `${short}/${year.slice(2)}`;
  else name = sameYear ? monthName(month) : `${short}. ${year}`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Fechada e com valor a pagar, dentro do prazo ou não. */
export function isUnpaid(invoice: CardInvoice): boolean {
  return invoice.status === "due" || invoice.status === "overdue";
}

/** Uma fatura fechada sem compra nenhuma não foi "paga": não tinha o que pagar. */
export function statusLabel(invoice: CardInvoice): string {
  if (invoice.status === "paid" && invoice.amount_cents === 0) return "Sem compras";
  return STATUS_LABELS[invoice.status];
}

/**
 * A fatura em que a tela abre: a mais nova entre as que estão a pagar, porque é a que pede
 * uma ação; sem nenhuma, a atual.
 */
export function initialInvoice(invoices: readonly CardInvoice[]): CardInvoice | undefined {
  return invoices.filter(isUnpaid).at(-1) ?? invoices.find(isCurrent) ?? invoices.at(-1);
}

/** "vence hoje", "vence em 5 dias", "venceu ontem" ou "venceu há 3 dias". */
export function dueLabel(dueDate: ISODate, reference: ISODate = today()): string {
  const days = daysBetween(reference, dueDate);
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  if (days > 1) return `vence em ${days} dias`;
  if (days === -1) return "venceu ontem";
  return `venceu há ${-days} dias`;
}

/** "fecha amanhã" ou "fecha em 23 dias": a fatura aberta sempre fecha depois de hoje. */
export function closingLabel(closingDate: ISODate, reference: ISODate = today()): string {
  const days = daysBetween(reference, closingDate);
  return days <= 1 ? "fecha amanhã" : `fecha em ${days} dias`;
}

/** A fatura que o "Pagar fatura" quita: a última fechada, enquanto houver o que pagar nela. */
export function isLastClosed(invoice: InvoiceSummary, payment: InvoicePayment): boolean {
  return payment.closed_invoice?.closing_date === invoice.closing_date;
}

/**
 * O que falta pagar ao abrir uma fatura fechada. Na última fechada é tudo o que se deve das
 * fechadas, que é o valor do "Pagar fatura"; nas anteriores, a parte que ficou de cada uma.
 */
export function amountToPay(invoice: CardInvoice, payment: InvoicePayment): number {
  const closed = payment.closed_invoice;
  return closed && isLastClosed(invoice, payment) ? closed.amount_cents : invoice.remaining_cents;
}

/** Como o cartão está hoje: com fatura vencida, com fatura a pagar ou em dia. */
export type CardStanding = "overdue" | "due" | "clear";

export function cardStanding(payment: InvoicePayment, reference: ISODate = today()): CardStanding {
  const closed = payment.closed_invoice;
  if (!closed) return "clear";
  return closed.due_date < reference ? "overdue" : "due";
}
