import { CalendarClock, CircleCheck, Clock, TriangleAlert, type LucideIcon } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { shortDate, today } from "../../../lib/dates";
import { formatBRL, formatCentsAsDecimal } from "../../../lib/money";
import type { Account } from "../../accounts/types";
import type { InvoicePayment } from "../../dashboard/types";
import {
  amountToPay,
  closingLabel,
  dueLabel,
  invoiceMonth,
  isLastClosed,
  isUnpaid,
  statusLabel,
} from "../invoices";
import type { CardInvoice, InvoiceStatus } from "../types";

export interface InvoicePanelProps {
  invoice: CardInvoice;
  /** A fatura anterior, para dizer se esta veio maior ou menor. */
  previous?: CardInvoice;
  /** O que pagar no cartão hoje. */
  payment: InvoicePayment;
  /** A conta do cartão, para dizer quando ele está com saldo a favor. */
  account?: Account;
  /** Abre a transferência de uma conta para o cartão. */
  onPay: () => void;
}

interface SealProps {
  invoice: CardInvoice;
}

// A partir daqui o número principal não cabe em 320px no tamanho de destaque.
const LONG_VALUE_LENGTH = 11;

const HERO_LABELS: Record<InvoiceStatus, string> = {
  due: "Falta pagar",
  overdue: "Falta pagar",
  paid: "Total da fatura",
  open: "Até agora",
  future: "Já lançado",
};

const SEALS: Record<InvoiceStatus, { icon: LucideIcon; tone: string }> = {
  paid: { icon: CircleCheck, tone: "bg-income-soft text-income" },
  due: { icon: Clock, tone: "bg-primary-soft text-primary" },
  overdue: { icon: TriangleAlert, tone: "bg-warning-soft text-warning" },
  open: { icon: CalendarClock, tone: "bg-bg-sunken text-ink-muted" },
  future: { icon: CalendarClock, tone: "bg-bg-sunken text-ink-muted" },
};

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function sealText(invoice: CardInvoice): string {
  if (invoice.status === "due") return `Fechada, ${dueLabel(invoice.due_date)}`;
  if (invoice.status === "overdue") return capitalized(dueLabel(invoice.due_date));
  if (invoice.status === "open") return `Aberta, ${closingLabel(invoice.closing_date)}`;
  return statusLabel(invoice);
}

/** O estado da fatura, com ícone e texto: a cor nunca é o único sinal. */
function Seal({ invoice }: SealProps) {
  const { icon: Icon, tone } = SEALS[invoice.status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-micro", tone)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {sealText(invoice)}
    </span>
  );
}

/** O período das compras e as datas da fatura, no tempo certo do verbo. */
function dates(invoice: CardInvoice): string {
  const period = `Compras de ${shortDate(invoice.period_start)} a ${shortDate(invoice.period_end)}`;
  const closed = invoice.status !== "open" && invoice.status !== "future";
  const closing = `${closed ? "fechou" : "fecha"} em ${shortDate(invoice.closing_date)}`;
  const due = `${invoice.due_date < today() ? "venceu" : "vence"} em ${shortDate(invoice.due_date)}`;
  return [period, closing, due].join(" · ");
}

/**
 * Por que o que falta pagar não é o total da fatura: parte já foi paga, ou sobrou algo de
 * antes dela (faturas anteriores, ou a dívida que o cartão já tinha ao ser cadastrado).
 */
function unpaidNote(invoice: CardInvoice, payment: InvoicePayment): string | null {
  const lastClosed = isLastClosed(invoice, payment);
  const paid = Math.max(invoice.amount_cents, 0) - invoice.remaining_cents;
  const carried = lastClosed ? amountToPay(invoice, payment) - invoice.remaining_cents : 0;
  const parts: string[] = [];
  if (paid > 0 || carried > 0) parts.push(`Total da fatura: ${formatBRL(invoice.amount_cents)}.`);
  if (paid > 0) parts.push(`Você já pagou ${formatBRL(paid)}.`);
  if (carried > 0) parts.push(`${formatBRL(carried)} ficaram de antes desta fatura.`);
  if (!lastClosed) parts.push("Esse valor já está somado no que falta pagar do cartão.");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Só entre faturas fechadas: a aberta ainda está pela metade, e a comparação enganaria. */
function comparison(invoice: CardInvoice, previous: CardInvoice | undefined): string | null {
  if (!previous || invoice.status === "open" || invoice.status === "future") return null;
  if (invoice.amount_cents <= 0 || previous.amount_cents <= 0) return null;
  const difference = invoice.amount_cents - previous.amount_cents;
  const other = `a fatura de ${invoiceMonth(previous)}`;
  if (difference === 0) return `O mesmo valor d${other}.`;
  return `${formatBRL(Math.abs(difference))} ${difference > 0 ? "a mais" : "a menos"} que ${other}.`;
}

function notes(
  invoice: CardInvoice,
  previous: CardInvoice | undefined,
  payment: InvoicePayment,
): string[] {
  const lines: (string | null)[] = [];
  if (isUnpaid(invoice)) lines.push(unpaidNote(invoice, payment));
  if (invoice.status === "open") {
    lines.push(
      `Compras até ${shortDate(invoice.period_end)} entram nesta fatura; ` +
        `a partir de ${shortDate(invoice.closing_date)}, na seguinte.`,
    );
  }
  if (invoice.status === "future") {
    lines.push("Por enquanto, só o que já está lançado: parcelas e compras com data futura.");
  }
  lines.push(comparison(invoice, previous));
  return lines.filter((line): line is string => line !== null);
}

/**
 * O que o "Pagar fatura" vai quitar quando a fatura da tela não é a que está a pagar: a
 * fatura fechada do cartão, se houver; sem ela, o que já se deve nele; ou nada.
 */
function paymentNote(invoice: CardInvoice, payment: InvoicePayment): string {
  const closed = payment.closed_invoice;
  if (closed) {
    return (
      `Há uma fatura fechada a pagar neste cartão: ${formatBRL(closed.amount_cents)}, ` +
      `${dueLabel(closed.due_date)}.`
    );
  }
  if (payment.total_due_cents > 0) {
    const lead =
      invoice.status === "open" ? "Esta fatura ainda não fechou" : "Não há fatura fechada a pagar";
    return (
      `${lead}: o pagamento adianta o que você já deve no cartão, ` +
      `${formatBRL(payment.total_due_cents)}.`
    );
  }
  return "Pelo saldo do cartão, você não deve nada nele hoje.";
}

/**
 * A fatura escolhida: o estado, o número que importa nela (o que falta pagar, ou o total) com
 * o traço de marca-texto, as datas e a ação. "Pagar fatura" está sempre à vista: é o botão
 * principal enquanto a fatura da tela está a pagar e, nas outras, um botão secundário que diz
 * o que o pagamento vai quitar.
 */
export function InvoicePanel({ invoice, previous, payment, account, onPay }: InvoicePanelProps) {
  const unpaid = isUnpaid(invoice);
  const cents = unpaid ? amountToPay(invoice, payment) : invoice.amount_cents;
  const value = formatCentsAsDecimal(cents);
  const long = value.length >= LONG_VALUE_LENGTH;
  // Sem dívida e com saldo positivo, o cartão está com crédito, por um pagamento a mais: ele
  // abate a fatura seguinte.
  const creditCents = payment.total_due_cents === 0 ? Math.max(account?.balance_cents ?? 0, 0) : 0;

  return (
    <div className="grid gap-4 p-4 sm:p-5">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="font-display text-title-2 text-ink">Fatura de {invoiceMonth(invoice)}</h2>
          <Seal invoice={invoice} />
        </div>
        <p className="mt-2 text-label text-ink-muted">{HERO_LABELS[invoice.status]}</p>
        <p
          className={cn(
            "money text-ink",
            long
              ? "text-money-lg sm:text-money-hero lg:text-money-hero-lg"
              : "text-money-hero lg:text-money-hero-lg",
          )}
        >
          <span className="marca-texto">
            {cents < 0 && "−"}
            <span
              className={cn(
                "mr-1.5 font-normal",
                long ? "text-body sm:text-title-2 lg:text-title-1" : "text-title-2 lg:text-title-1",
              )}
            >
              R$
            </span>
            {value}
          </span>
        </p>
        <p className="mt-1 text-small text-ink-muted">{dates(invoice)}</p>
      </div>

      {notes(invoice, previous, payment).map((line) => (
        <p key={line} className="text-small text-ink-muted">
          {line}
        </p>
      ))}

      <div className="grid gap-2 sm:flex sm:items-center sm:gap-4">
        <Button variant={unpaid ? "primary" : "secondary"} onClick={onPay}>
          Pagar fatura
        </Button>
        <p className="text-small text-ink-muted">
          {unpaid
            ? "Sai de uma conta sua para o cartão e não conta como gasto de novo."
            : paymentNote(invoice, payment)}
        </p>
      </div>
      {creditCents > 0 && (
        <p className="text-small text-ink-muted">
          O cartão está com {formatBRL(creditCents)} a seu favor, de pagamento a mais: esse valor
          abate as próximas compras.
        </p>
      )}
    </div>
  );
}
