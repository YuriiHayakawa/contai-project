import { Suspense, lazy } from "react";

import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { monthLabel } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import type { CardSummary } from "../../dashboard/types";

// O gráfico traz o Recharts, que fica no arquivo próprio dele.
const InstallmentsChart = lazy(() =>
  import("./InstallmentsChart").then((module) => ({ default: module.InstallmentsChart })),
);

export interface CardInstallmentsProps {
  card: CardSummary;
}

/**
 * O que já está comprometido no cartão: as parcelas das faturas depois da atual, no total e
 * por mês de vencimento (FR-058).
 */
export function CardInstallments({ card }: CardInstallmentsProps) {
  const future = card.future_installments;
  const lastMonth = future.months.at(-1)?.month;

  return (
    <Card title="Parcelas futuras">
      <p className="money text-money-lg text-ink">{formatBRL(future.total_cents)}</p>
      <p className="text-small text-ink-muted">
        {lastMonth
          ? `Depois da fatura atual, até a de ${monthLabel(lastMonth).toLowerCase()}`
          : "Nenhuma compra parcelada pela frente"}
      </p>
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
