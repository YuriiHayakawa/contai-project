import { Suspense, lazy } from "react";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { monthName, shortDate } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import type { TransactionPreset } from "../../transactions/types";
import { invoicePaymentPreset } from "../../transactions/presets";
import type { AccountBalance, CardSummary } from "../types";

// O gráfico traz o Recharts, que fica no arquivo próprio dele.
const InstallmentsChart = lazy(() =>
  import("./InstallmentsChart").then((module) => ({ default: module.InstallmentsChart })),
);

export interface CardsCardProps {
  card: CardSummary;
  /** Saldo de hoje do cartão: o que se deve nele, para o pagamento já vir preenchido. */
  balance?: AccountBalance;
  /** Abre a folha de transferência para pagar a fatura. */
  onPay: (preset: TransactionPreset) => void;
}

/**
 * Um cartão de crédito no painel (FR-058): a fatura atual, com o fechamento e o vencimento, e
 * as parcelas futuras, por mês e no total. "Pagar fatura" abre a transferência da conta para o
 * cartão, que não conta como gasto.
 */
export function CardsCard({ card, balance, onPay }: CardsCardProps) {
  const { current_invoice: invoice, future_installments: future } = card;
  const lastMonth = future.months.at(-1)?.month;

  return (
    <Card
      title={card.name}
      action={
        <Button
          variant="ghost"
          className="-mr-3"
          onClick={() =>
            onPay(
              invoicePaymentPreset({
                id: card.account_id,
                name: card.name,
                balance_cents: balance?.balance_cents ?? -invoice.amount_cents,
              }),
            )
          }
        >
          Pagar fatura
        </Button>
      }
    >
      <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="grid gap-0.5 pb-3 sm:pr-4 sm:pb-0">
          <dt className="text-label text-ink-muted">Fatura atual</dt>
          <dd className="money text-money-lg text-ink">{formatBRL(invoice.amount_cents)}</dd>
          <dd className="text-small text-ink-muted">
            Fecha em {shortDate(invoice.closing_date)} · vence em {shortDate(invoice.due_date)}
          </dd>
        </div>
        <div className="grid gap-0.5 pt-3 sm:pt-0 sm:pl-4">
          <dt className="text-label text-ink-muted">Parcelas futuras</dt>
          <dd className="money text-money-lg text-ink">{formatBRL(future.total_cents)}</dd>
          <dd className="text-small text-ink-muted">
            {lastMonth
              ? `Até a fatura de ${monthName(lastMonth)} de ${lastMonth.slice(0, 4)}`
              : "Nenhuma compra parcelada pela frente"}
          </dd>
        </div>
      </dl>
      {future.months.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <Suspense fallback={<Skeleton className="h-36 w-full" />}>
            <InstallmentsChart months={future.months} cardName={card.name} />
          </Suspense>
        </div>
      )}
    </Card>
  );
}
