import { CreditCard, TriangleAlert } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { TextLink } from "../../../components/ui/TextLink";
import { cn } from "../../../lib/cn";
import { shortDate, yearMonthOf } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { cardPath } from "../../../lib/paths";
import type { CardSummary, ClosedInvoiceDue } from "../../dashboard/types";
import { invoicePaymentPreset } from "../../transactions/presets";
import type { TransactionPreset } from "../../transactions/types";
import { cardStanding, dueLabel } from "../invoices";

export interface InvoiceDueNoticeProps {
  /** Os cartões ativos, com o que pagar em cada um hoje. */
  cards: readonly CardSummary[];
  /** Abre a transferência de uma conta para o cartão. */
  onPay: (preset: TransactionPreset) => void;
  className?: string;
}

interface DueCard extends CardSummary {
  payment: CardSummary["payment"] & { closed_invoice: ClosedInvoiceDue };
}

function hasClosedInvoice(card: CardSummary): card is DueCard {
  return card.payment.closed_invoice !== null;
}

/**
 * Aviso de fatura a pagar, no topo do Início: aparece enquanto um cartão tem fatura fechada
 * com valor a pagar, e some quando ela é paga. Diz o valor e o prazo e leva ao pagamento ou à
 * fatura. Vencida, vira alerta, com ícone e texto próprios: a cor nunca é o único sinal.
 */
export function InvoiceDueNotice({ cards, onPay, className }: InvoiceDueNoticeProps) {
  const due = cards.filter(hasClosedInvoice);
  if (due.length === 0) return null;

  return (
    <section aria-label="Faturas a pagar" className={cn("grid gap-3", className)}>
      {due.map((card) => {
        const closed = card.payment.closed_invoice;
        const overdue = cardStanding(card.payment) === "overdue";
        const Icon = overdue ? TriangleAlert : CreditCard;
        return (
          <div
            key={card.account_id}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg p-4 sm:px-5",
              overdue ? "bg-warning-soft" : "bg-primary-soft",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full",
                overdue ? "bg-warning text-surface" : "bg-primary text-on-primary",
              )}
            >
              <Icon className="size-5.5" />
            </span>
            <div className="grid min-w-0 flex-[1_1_14rem]">
              <h2 className="text-title-3 text-ink">
                {overdue ? "Fatura vencida" : "Fatura fechada"}: {card.name}
              </h2>
              <p className="text-body text-ink-muted">
                <span className="money font-bold text-ink">{formatBRL(closed.amount_cents)}</span>
                {" · "}
                {dueLabel(closed.due_date)}, em {shortDate(closed.due_date)}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 sm:w-auto">
              <Button
                className="flex-1 sm:flex-none"
                onClick={() =>
                  onPay(
                    invoicePaymentPreset({
                      id: card.account_id,
                      name: card.name,
                      payment: card.payment,
                    }),
                  )
                }
              >
                Pagar fatura
              </Button>
              <TextLink
                standalone
                to={cardPath(card.account_id, yearMonthOf(closed.closing_date))}
                aria-label={`Ver fatura: ${card.name}`}
              >
                Ver fatura
              </TextLink>
            </div>
          </div>
        );
      })}
    </section>
  );
}
