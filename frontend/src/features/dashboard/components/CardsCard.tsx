import { CreditCard } from "lucide-react";
import { Link } from "react-router";

import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { cn } from "../../../lib/cn";
import { shortDate } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { cardPath, paths } from "../../../lib/paths";
import type { CardSummary } from "../types";

export interface CardsCardProps {
  /** Cartões ativos, em ordem alfabética. */
  cards: readonly CardSummary[];
}

/**
 * Os cartões de crédito no painel (FR-058): de cada um, a fatura atual, com o fechamento, e o
 * total das parcelas futuras. A linha leva à tela do cartão, onde ficam as faturas, os
 * lançamentos de cada uma e o "Pagar fatura".
 */
export function CardsCard({ cards }: CardsCardProps) {
  return (
    <Card
      title="Cartões"
      action={
        <TextLink to={paths.cards} standalone className="text-small">
          Ver cartões
        </TextLink>
      }
    >
      <ul className="divide-y divide-border">
        {cards.map((card) => {
          const { current_invoice: invoice, future_installments: future } = card;
          return (
            <li key={card.account_id}>
              <Link
                to={cardPath(card.account_id)}
                className={cn(
                  "-mx-2 grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3",
                  "rounded-md px-2 py-2.5 transition-colors duration-fast ease-out",
                  "hover:bg-bg-sunken",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full bg-bg-sunken text-ink-muted"
                >
                  <CreditCard className="size-4.5" />
                </span>
                <span className="grid min-w-0">
                  <span className="truncate text-body font-bold text-ink">{card.name}</span>
                  <span className="truncate text-small text-ink-muted">
                    {card.current_invoice_paid
                      ? "Fatura atual · paga"
                      : `Fatura atual · fecha em ${shortDate(invoice.closing_date)}`}
                  </span>
                  <span className="truncate text-small text-ink-muted">
                    {future.total_cents > 0
                      ? `Parcelas futuras: ${formatBRL(future.total_cents)}`
                      : "Sem parcelas pela frente"}
                  </span>
                </span>
                <span className="money text-money-md text-ink">
                  {formatBRL(invoice.amount_cents)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
