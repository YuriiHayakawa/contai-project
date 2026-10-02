import { ArrowLeftRight } from "lucide-react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import { Button } from "../../../components/ui/Button";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dayLabel, type ISODate } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import type { Account } from "../../accounts/types";
import type { CategoryOption } from "../../categories/hooks/useCategories";
import type { Transaction } from "../types";

export interface TransactionListProps {
  /** Nome da lista para leitores de tela, como "Lançamentos de setembro de 2026". */
  label: string;
  /** Lançamentos já carregados, do mais novo para o mais antigo; `undefined` na primeira carga. */
  transactions: readonly Transaction[] | undefined;
  /** Quantos lançamentos atendem aos filtros, somando as páginas ainda não carregadas. */
  totalCount: number;
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, CategoryOption>;
  /** Falha ao carregar a lista; a mensagem diz o que fazer. */
  error?: unknown;
  onRetry: () => void;
  /** O que aparece sem lançamentos: o convite da primeira vez ou "sem resultados". */
  empty: ReactNode;
  onSelect: (transaction: Transaction) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

interface DayGroup {
  date: ISODate;
  transactions: Transaction[];
}

interface TransactionRowProps {
  transaction: Transaction;
  account: Account | undefined;
  category: CategoryOption | undefined;
  onSelect: (transaction: Transaction) => void;
}

function groupByDay(transactions: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const last = groups.at(-1);
    if (last?.date === transaction.date) last.transactions.push(transaction);
    else groups.push({ date: transaction.date, transactions: [transaction] });
  }
  return groups;
}

/** Receitas menos despesas do dia. Transferência não é uma coisa nem outra. */
function dayTotalCents(transactions: readonly Transaction[]): number {
  return transactions.reduce((total, transaction) => {
    if (transaction.type === "income") return total + transaction.amount_cents;
    if (transaction.type === "expense") return total - transaction.amount_cents;
    return total;
  }, 0);
}

/** Despesa com `−`, receita com `+` e transferência sem sinal: a cor nunca é o único sinal. */
export function signedAmount(transaction: Transaction): string {
  if (transaction.type === "income") return formatBRL(transaction.amount_cents, { sign: "always" });
  if (transaction.type === "expense") return formatBRL(-transaction.amount_cents);
  return formatBRL(transaction.amount_cents, { sign: "never" });
}

function countLabel(loaded: number, total: number): string {
  const noun = total === 1 ? "lançamento" : "lançamentos";
  return loaded < total ? `Mostrando ${loaded} de ${total} ${noun}` : `${total} ${noun}`;
}

function TransactionRow({ transaction, account, category, onSelect }: TransactionRowProps) {
  const isTransfer = transaction.type === "transfer";
  const details = [
    isTransfer ? "Transferência" : category?.category.name,
    account?.name,
    transaction.installment_number && transaction.installment_count
      ? `${transaction.installment_number}/${transaction.installment_count}`
      : null,
  ].filter(Boolean);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(transaction)}
        className={cn(
          "grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3",
          "px-3 py-2.5 text-left transition-colors duration-fast ease-out hover:bg-bg-sunken",
        )}
      >
        {isTransfer ? (
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-bg-sunken text-ink-muted"
          >
            <ArrowLeftRight className="size-4.5" />
          </span>
        ) : (
          <CategoryChip
            color={category?.category.color ?? "ardosia"}
            icon={category?.category.icon ?? ""}
          />
        )}
        <span className="min-w-0 pl-2">
          <span className="line-clamp-2 wrap-break-word text-body font-bold text-ink">
            {transaction.description}
          </span>
          <span className="block truncate text-small text-ink-muted">{details.join(" · ")}</span>
        </span>
        <span
          className={cn(
            "money text-money-md",
            transaction.type === "income" && "text-income",
            transaction.type === "expense" && "text-ink",
            isTransfer && "text-ink-muted",
          )}
        >
          {signedAmount(transaction)}
        </span>
      </button>
    </li>
  );
}

/**
 * Lista de lançamentos (seção 6.6 do design-system.md): grupos por dia com cabeçalho fixo e
 * total, pauta entre as linhas e a linha de margem, como em um caderno. A linha inteira abre o
 * detalhe do lançamento.
 */
export function TransactionList({
  label,
  transactions,
  totalCount,
  accounts,
  categories,
  error,
  onRetry,
  empty,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: TransactionListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadedCount = transactions?.length ?? 0;

  const loadMore = useEffectEvent(() => {
    if (!loadingMore) onLoadMore();
  });

  // Carrega a página seguinte quando o fim da lista se aproxima; o botão "Carregar mais" fica
  // como alternativa. A cada página, a observação recomeça: o fim pode continuar à vista.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadedCount]);

  if (!transactions) {
    if (error) {
      return (
        <EmptyState
          kind="error"
          title="Não foi possível carregar seus lançamentos"
          description={errorMessage(error)}
          onAction={onRetry}
        />
      );
    }
    return (
      <section aria-label={label} className="rounded-lg border border-border bg-surface">
        <SkeletonList label="Carregando seus lançamentos…" />
      </section>
    );
  }

  if (transactions.length === 0) return empty;

  const groups = groupByDay(transactions);

  return (
    // `overflow-clip` arredonda os cantos sem criar uma área de rolagem, que soltaria os
    // cabeçalhos fixos.
    <section
      aria-label={label}
      className={cn(
        "relative overflow-clip rounded-lg border border-border bg-surface",
        // Linha de margem: os selos ficam à esquerda dela e o texto à direita.
        "before:absolute before:inset-y-0 before:left-13.5 before:w-0.5 before:bg-margin-line",
      )}
    >
      {groups.map((group, index) => {
        // Com páginas por carregar, o último dia pode estar pela metade: o total dele esperaria.
        const partial = hasMore && index === groups.length - 1;
        return (
          <section key={group.date} aria-label={dayLabel(group.date)}>
            <header
              className={cn(
                "sticky top-0 z-10 flex items-center justify-between gap-3 bg-bg-sunken",
                "border-b border-border py-2.5 pr-3 pl-16.5",
                index > 0 && "border-t",
              )}
            >
              <h2 className="text-label text-ink-muted">{dayLabel(group.date)}</h2>
              {!partial && (
                <p className="money text-money-sm text-ink-muted">
                  <span className="sr-only">Total do dia: </span>
                  {formatBRL(dayTotalCents(group.transactions), { sign: "always" })}
                </p>
              )}
            </header>
            <ul>
              {group.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  account={accounts.get(transaction.account_id)}
                  category={
                    transaction.category_id ? categories.get(transaction.category_id) : undefined
                  }
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <footer
        ref={sentinelRef}
        className="relative grid justify-items-center gap-2 border-t border-border bg-surface p-3"
      >
        <p role="status" className="text-small text-ink-muted">
          {countLabel(loadedCount, totalCount)}
        </p>
        {hasMore && (
          <Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>
            Carregar mais
          </Button>
        )}
      </footer>
    </section>
  );
}
