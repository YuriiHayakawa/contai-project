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
import { ACCOUNT_TYPE_ICONS } from "../../accounts/account-type-icons";
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

interface TransferRowProps {
  /** A linha que sai da conta de origem. */
  out: Transaction;
  /** A linha que entra na conta de destino. */
  received: Transaction;
  accounts: ReadonlyMap<string, Account>;
  onSelect: (transaction: Transaction) => void;
}

interface TransferLegProps {
  side: Transaction;
  account: Account | undefined;
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

/** Um lado de transferência visto da própria conta: `−` na que sai e `+` na que entra. */
function transferSideAmount(side: Transaction): string {
  const cents = side.transfer_direction === "out" ? -side.amount_cents : side.amount_cents;
  return formatBRL(cents, { sign: "always" });
}

const OTHER_ACCOUNT = "outra conta";

const transferVerb = (side: Transaction): string =>
  side.transfer_direction === "out" ? "Saiu de" : "Entrou em";

/** Com um lado só na tela: "saiu de Investimento" ou "entrou em Conta Principal". */
function transferSideLabel(side: Transaction, account: Account | undefined): string {
  return `${transferVerb(side).toLowerCase()} ${account?.name ?? OTHER_ACCOUNT}`;
}

function TransferSeal({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 items-center justify-center rounded-full bg-bg-sunken text-ink-muted",
        className,
      )}
    >
      <ArrowLeftRight className="size-4.5" />
    </span>
  );
}

function countLabel(loaded: number, total: number): string {
  const noun = total === 1 ? "lançamento" : "lançamentos";
  return loaded < total ? `Mostrando ${loaded} de ${total} ${noun}` : `${total} ${noun}`;
}

/**
 * Os dois lados de uma transferência em uma linha só, como um trajeto de mapa: a conta de onde
 * saiu e a em que entrou são duas paradas ligadas por um pontilhado, cada uma com o seu sinal.
 * A linha abre o detalhe da transferência.
 */
function TransferRow({ out, received, accounts, onSelect }: TransferRowProps) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(out)}
        className={cn(
          "grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5",
          "px-3 py-2.5 text-left transition-colors duration-fast ease-out hover:bg-bg-sunken",
        )}
      >
        <TransferSeal className="row-span-2" />
        <span className="line-clamp-2 min-w-0 pl-2 wrap-break-word text-body font-bold text-ink">
          <span className="sr-only">Transferência: </span>
          {out.description}
        </span>
        <span className="relative grid min-w-0 gap-3 pl-2 text-small text-ink-muted">
          {/* O pontilhado passa por trás das paradas, de um centro ao outro. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-2.75 left-4.5 border-l-2 border-dotted border-ink-subtle"
          />
          <TransferLeg side={out} account={accounts.get(out.account_id)} />
          <TransferLeg side={received} account={accounts.get(received.account_id)} />
        </span>
      </button>
    </li>
  );
}

/** Uma parada do trajeto: o ícone da conta, o nome e o valor com sinal, alinhado à direita. */
function TransferLeg({ side, account }: TransferLegProps) {
  const Icon = account ? ACCOUNT_TYPE_ICONS[account.type] : undefined;
  const isOut = side.transfer_direction === "out";
  return (
    <span className="grid grid-cols-[1.375rem_minmax(0,1fr)_auto] items-center gap-2">
      {/* A origem é vazada e o destino, em azul: o dinheiro chega lá. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-5.5 items-center justify-center rounded-full border-[1.5px]",
          isOut
            ? "border-border-strong bg-surface text-ink-muted"
            : "border-primary bg-primary-soft text-primary",
        )}
      >
        {Icon && <Icon className="size-3" />}
      </span>
      <span className="truncate">
        {transferVerb(side)} {account?.name ?? OTHER_ACCOUNT}
      </span>
      <span className="money text-money-sm">{transferSideAmount(side)}</span>
    </span>
  );
}

function TransactionRow({ transaction, account, category, onSelect }: TransactionRowProps) {
  const isTransfer = transaction.type === "transfer";
  // Receita em categoria de despesa: o dinheiro de uma compra que voltou.
  const isRefund = transaction.type === "income" && category?.category.kind === "expense";
  const details = [
    isRefund && "Estorno",
    isTransfer ? "Transferência" : category?.category.name,
    // Só um lado da transferência está na tela: diz o que aconteceu nesta conta.
    isTransfer ? transferSideLabel(transaction, account) : account?.name,
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
          <TransferSeal />
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
          {isTransfer ? transferSideAmount(transaction) : signedAmount(transaction)}
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
  // Os dois lados de cada transferência que estão na tela. Com os dois carregados, a
  // transferência vira uma linha só, no lugar do primeiro deles.
  const transferSides = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (!transaction.transfer_group_id) continue;
    const sides = transferSides.get(transaction.transfer_group_id) ?? [];
    sides.push(transaction);
    transferSides.set(transaction.transfer_group_id, sides);
  }

  const renderRow = (transaction: Transaction): ReactNode => {
    const sides = transaction.transfer_group_id
      ? transferSides.get(transaction.transfer_group_id)
      : undefined;
    const out = sides?.find((side) => side.transfer_direction === "out");
    const received = sides?.find((side) => side.transfer_direction === "in");
    if (sides && out && received) {
      if (transaction.id !== sides[0]?.id) return null;
      return (
        <TransferRow
          key={transaction.id}
          out={out}
          received={received}
          accounts={accounts}
          onSelect={onSelect}
        />
      );
    }
    return (
      <TransactionRow
        key={transaction.id}
        transaction={transaction}
        account={accounts.get(transaction.account_id)}
        category={transaction.category_id ? categories.get(transaction.category_id) : undefined}
        onSelect={onSelect}
      />
    );
  };

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
            <ul>{group.transactions.map(renderRow)}</ul>
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
