import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { paths } from "../../../lib/paths";
import { CategoryRanking } from "../../dashboard/components/CategoryRanking";
import { FILTER_PARAM, type ListLinkFilters } from "../../transactions/filters";
import { useInvoiceCategories } from "../hooks/useCards";
import { invoiceKey } from "../invoices";
import type { CardInvoice } from "../types";

export interface InvoiceCategoriesProps {
  cardId: string;
  invoice: CardInvoice;
}

const TITLE = "Gastos da fatura por categoria";

/**
 * Para onde foi o gasto de uma fatura: as compras do cartão no período dela, por categoria,
 * com as mesmas barras do painel. Cada linha abre a lista de lançamentos já no cartão, no
 * período e na categoria.
 */
export function InvoiceCategories({ cardId, invoice }: InvoiceCategoriesProps) {
  const categories = useInvoiceCategories(cardId, invoiceKey(invoice));

  if (categories.data === undefined) {
    return (
      <Card title={TITLE}>
        {categories.isError ? (
          <div className="grid justify-items-start gap-1">
            <p className="text-body text-ink-muted">
              Não foi possível carregar os gastos por categoria.
            </p>
            <Button variant="ghost" className="-ml-5" onClick={() => void categories.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div role="status" className="grid gap-4">
            <span className="sr-only">Carregando os gastos por categoria…</span>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-9 w-3/5" />
          </div>
        )}
      </Card>
    );
  }

  const listPath = ({ category, type }: ListLinkFilters): string => {
    const params = new URLSearchParams({
      [FILTER_PARAM.account]: cardId,
      [FILTER_PARAM.from]: invoice.period_start,
      [FILTER_PARAM.to]: invoice.period_end,
    });
    if (category) params.set(FILTER_PARAM.category, category);
    if (type) params.set(FILTER_PARAM.type, type);
    return `${paths.transactions}?${params.toString()}`;
  };

  return (
    <CategoryRanking
      title={TITLE}
      items={categories.data.items}
      listPath={listPath}
      shareOf="da fatura"
      period="da fatura"
      empty={<p className="text-body text-ink-muted">Nenhuma despesa nesta fatura.</p>}
    />
  );
}
