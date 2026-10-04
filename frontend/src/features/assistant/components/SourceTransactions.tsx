import { ArrowRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "../../../lib/cn";
import { monthName, shortDate, today, yearMonthOf } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import {
  categoriesById,
  useCategories,
  type CategoryOption,
} from "../../categories/hooks/useCategories";
import type { SourceTransaction } from "../types";

export interface SourceTransactionsProps {
  /** As transações que vieram com a resposta: até 50, das que ainda existem. */
  transactions: readonly SourceTransaction[];
  /** Quantas compõem a resposta ao todo. */
  totalCount: number;
}

interface SourceRowProps {
  transaction: SourceTransaction;
  currentYear: string;
  /** Nomes das contas por id; vazio enquanto elas carregam. */
  accounts: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, CategoryOption>;
}

/** Quantas linhas aparecem antes de "Ver todas". */
export const COLLAPSED_ROWS = 5;

const OTHER_ACCOUNT = "outra conta";

/** Despesa com `−`, receita com `+` e transferência sem sinal: a cor nunca é o único sinal. */
function signedAmount({ type, amount_cents }: SourceTransaction): string {
  if (type === "income") return formatBRL(amount_cents, { sign: "always" });
  if (type === "expense") return formatBRL(-amount_cents);
  return formatBRL(amount_cents, { sign: "never" });
}

/**
 * O que identifica o lançamento, abaixo da descrição: em despesa e receita, a categoria e a
 * conta; em transferência, de qual conta o dinheiro saiu e em qual entrou.
 */
function details(
  transaction: SourceTransaction,
  accounts: ReadonlyMap<string, string>,
  categories: ReadonlyMap<string, CategoryOption>,
): ReactNode {
  const account = accounts.get(transaction.account_id);
  if (transaction.type === "transfer") {
    const destination = transaction.to_account_id
      ? (accounts.get(transaction.to_account_id) ?? OTHER_ACCOUNT)
      : OTHER_ACCOUNT;
    return (
      <>
        <span className="sr-only">Transferência de </span>
        <span className="truncate">{account ?? OTHER_ACCOUNT}</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only"> para </span>
        <span className="truncate">{destination}</span>
      </>
    );
  }
  const category = transaction.category_id ? categories.get(transaction.category_id) : undefined;
  // Receita em categoria de despesa: o dinheiro de uma compra que voltou.
  const refund = transaction.type === "income" && category?.category.kind === "expense";
  const parts = [refund && "Estorno", category?.label, account].filter(Boolean);
  return parts.length > 0 ? <span className="truncate">{parts.join(" · ")}</span> : null;
}

function SourceRow({ transaction, currentYear, accounts, categories }: SourceRowProps) {
  const year = transaction.date.slice(0, 4);
  const otherYear = year !== currentYear;
  const month = monthName(yearMonthOf(transaction.date), "short");
  const identified = details(transaction, accounts, categories);

  return (
    <li
      className={cn(
        "grid min-h-12 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3",
        "border-b border-border px-3 py-1.5 last:border-b-0",
      )}
    >
      {/* O dia fica na margem, como em uma folha de caderno: o número em cima e o mês embaixo. */}
      <time dateTime={transaction.date} className="row-span-2 grid justify-items-center">
        <span className="sr-only">
          {shortDate(transaction.date)}
          {otherYear && ` de ${year}`}
        </span>
        <span aria-hidden="true" className="money text-money-sm text-ink">
          {Number(transaction.date.slice(8, 10))}
        </span>
        <span aria-hidden="true" className="text-micro whitespace-nowrap text-ink-muted">
          {otherYear ? `${month}/${year.slice(2)}` : month}
        </span>
      </time>
      <span className="truncate pl-2 text-small text-ink">{transaction.description}</span>
      <span
        className={cn(
          // A partir de `sm`, o valor fica no meio da linha inteira, ao lado das duas linhas de
          // texto.
          "money text-money-sm sm:row-span-2",
          transaction.type === "income" && "text-income",
          transaction.type === "expense" && "text-ink",
          transaction.type === "transfer" && "text-ink-muted",
        )}
      >
        {signedAmount(transaction)}
      </span>
      {/* No celular o detalhe passa por baixo do valor e usa a largura toda: ao lado dele, os
          nomes das contas ficariam cortados em 320px. */}
      {identified && (
        <span className="col-span-2 col-start-2 flex min-w-0 items-center gap-1 pl-2 text-micro text-ink-muted sm:col-span-1">
          {identified}
        </span>
      )}
    </li>
  );
}

/**
 * "De onde veio esse número" (seção 8 do design-system.md): as transações que compõem o valor
 * da resposta (FR-063), em linhas compactas com pauta e margem. Cada linha diz o que foi e
 * onde: a categoria e a conta ou, em uma transferência, as duas contas. Vem aberto, com até 5
 * linhas; "Ver todas" mostra as demais no próprio bloco.
 */
export function SourceTransactions({ transactions, totalCount }: SourceTransactionsProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const accounts = useAccounts();
  const categories = useCategories();
  const currentYear = today().slice(0, 4);

  const accountNames = new Map((accounts.data ?? []).map((account) => [account.id, account.name]));
  const categoryOptions = categories.data
    ? categoriesById(categories.data)
    : new Map<string, CategoryOption>();

  const total = Math.max(totalCount, transactions.length);
  const expandable = transactions.length > COLLAPSED_ROWS;
  const shown = expanded ? transactions : transactions.slice(0, COLLAPSED_ROWS);
  // A resposta traz no máximo 50, e só as que ainda existem: o total pode ser maior.
  const missing = shown.length === transactions.length && total > transactions.length;

  return (
    <section
      aria-label="De onde veio esse número"
      className="w-full overflow-hidden rounded-lg border border-border bg-surface"
    >
      <h2 className="border-b border-border bg-bg-sunken px-3 py-2 text-label text-ink-muted">
        De onde veio esse número
      </h2>
      <ul
        id={listId}
        className={cn(
          "relative",
          // Linha de margem: o dia fica à esquerda dela e a descrição à direita.
          "before:absolute before:inset-y-0 before:left-15.5 before:w-0.5 before:bg-margin-line",
        )}
      >
        {shown.map((transaction) => (
          <SourceRow
            key={transaction.id}
            transaction={transaction}
            currentYear={currentYear}
            accounts={accountNames}
            categories={categoryOptions}
          />
        ))}
      </ul>
      {(expandable || missing) && (
        <footer className="flex flex-wrap items-center gap-x-3 border-t border-border px-3">
          {expandable && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((current) => !current)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-sm text-small font-bold text-primary",
                "underline underline-offset-[3px] transition-colors duration-fast ease-out",
                "hover:text-primary-hover",
              )}
            >
              {expanded ? "Ver menos" : `Ver todas as ${total}`}
            </button>
          )}
          {missing && (
            <p className="py-3 text-small text-ink-muted">
              Mostrando {transactions.length} de {total}.
            </p>
          )}
        </footer>
      )}
    </section>
  );
}
