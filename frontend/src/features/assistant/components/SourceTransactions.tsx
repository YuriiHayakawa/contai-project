import { useId, useState } from "react";

import { cn } from "../../../lib/cn";
import { monthName, shortDate, today, yearMonthOf } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
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
}

/** Quantas linhas aparecem antes de "Ver todas". */
export const COLLAPSED_ROWS = 5;

/** Despesa com `−`, receita com `+` e transferência sem sinal: a cor nunca é o único sinal. */
function signedAmount({ type, amount_cents }: SourceTransaction): string {
  if (type === "income") return formatBRL(amount_cents, { sign: "always" });
  if (type === "expense") return formatBRL(-amount_cents);
  return formatBRL(amount_cents, { sign: "never" });
}

function SourceRow({ transaction, currentYear }: SourceRowProps) {
  const year = transaction.date.slice(0, 4);
  const otherYear = year !== currentYear;
  const month = monthName(yearMonthOf(transaction.date), "short");

  return (
    <li
      className={cn(
        "grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3",
        "border-b border-border px-3 py-1.5 last:border-b-0",
      )}
    >
      {/* O dia fica na margem, como em uma folha de caderno: o número em cima e o mês embaixo. */}
      <time dateTime={transaction.date} className="grid justify-items-center">
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
          "money text-money-sm",
          transaction.type === "income" && "text-income",
          transaction.type === "expense" && "text-ink",
          transaction.type === "transfer" && "text-ink-muted",
        )}
      >
        {signedAmount(transaction)}
      </span>
    </li>
  );
}

/**
 * "De onde veio esse número" (seção 8 do design-system.md): as transações que compõem o valor
 * da resposta (FR-063), em linhas compactas com pauta e margem. Vem aberto, com até 5 linhas;
 * "Ver todas" mostra as demais no próprio bloco.
 */
export function SourceTransactions({ transactions, totalCount }: SourceTransactionsProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const currentYear = today().slice(0, 4);

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
          <SourceRow key={transaction.id} transaction={transaction} currentYear={currentYear} />
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
