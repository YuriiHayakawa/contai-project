import { useMemo, useState } from "react";

import { cn } from "../../../lib/cn";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import {
  categoriesById,
  useCategories,
  type CategoryOption,
} from "../../categories/hooks/useCategories";
import { TransactionDetail } from "../../transactions/components/TransactionDetail";
import { TransactionList } from "../../transactions/components/TransactionList";
import { TransactionSheet } from "../../transactions/components/TransactionSheet";
import { useTransactions } from "../../transactions/hooks/useTransactions";
import type { Transaction, TransactionFilters } from "../../transactions/types";
import { invoiceMonth } from "../invoices";
import type { CardInvoice } from "../types";

export interface InvoiceTransactionsProps {
  cardId: string;
  invoice: CardInvoice;
}

/**
 * Os lançamentos de uma fatura: as compras e os estornos do cartão no período dela, que somam
 * o valor da fatura. O pagamento é uma transferência e fica de fora. Cada linha abre o
 * detalhe, de onde dá para editar ou excluir, como na tela de lançamentos.
 */
export function InvoiceTransactions({ cardId, invoice }: InvoiceTransactionsProps) {
  const accounts = useAccounts();
  const categories = useCategories();
  const filters = useMemo<TransactionFilters>(
    () => ({
      account_id: cardId,
      from: invoice.period_start,
      to: invoice.period_end,
      without_transfers: true,
    }),
    [cardId, invoice.period_start, invoice.period_end],
  );
  const transactions = useTransactions(filters);

  const [detailOpen, setDetailOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Ficam guardados depois de fechar, para as folhas não esvaziarem enquanto saem da tela.
  const [selected, setSelected] = useState<Transaction | undefined>(undefined);
  const [editing, setEditing] = useState<Transaction | undefined>(undefined);

  const accountsMap = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account])),
    [accounts.data],
  );
  const categoriesMap = useMemo(
    () => (categories.data ? categoriesById(categories.data) : new Map<string, CategoryOption>()),
    [categories.data],
  );

  const pages = transactions.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items), [pages]);

  return (
    <section aria-labelledby="lancamentos-da-fatura" className="grid gap-3">
      <h2 id="lancamentos-da-fatura" className="text-title-3 text-ink">
        Lançamentos desta fatura
      </h2>
      {/* Ao trocar de fatura, a lista anterior fica esmaecida até a nova chegar. */}
      <div
        aria-busy={transactions.isPlaceholderData || undefined}
        className={cn(
          "transition-opacity duration-fast ease-out",
          transactions.isPlaceholderData && "opacity-60",
        )}
      >
        <TransactionList
          label={`Lançamentos da fatura de ${invoiceMonth(invoice)}`}
          transactions={items}
          totalCount={pages?.[0]?.total_count ?? 0}
          accounts={accountsMap}
          categories={categoriesMap}
          error={transactions.error}
          onRetry={() => void transactions.refetch()}
          empty={
            <p className="rounded-lg border border-border bg-surface p-4 text-body text-ink-muted sm:p-5">
              Nenhuma compra nesta fatura.
            </p>
          }
          onSelect={(transaction) => {
            setSelected(transaction);
            setDetailOpen(true);
          }}
          hasMore={transactions.hasNextPage}
          loadingMore={transactions.isFetchingNextPage}
          onLoadMore={() => void transactions.fetchNextPage()}
        />
      </div>

      <TransactionDetail
        open={detailOpen}
        transaction={selected}
        accounts={accountsMap}
        category={selected?.category_id ? categoriesMap.get(selected.category_id) : undefined}
        onClose={() => setDetailOpen(false)}
        onEdit={(transaction) => {
          setDetailOpen(false);
          setEditing(transaction);
          setEditorOpen(true);
        }}
      />
      <TransactionSheet
        open={editorOpen}
        transaction={editing}
        onClose={() => setEditorOpen(false)}
      />
    </section>
  );
}
