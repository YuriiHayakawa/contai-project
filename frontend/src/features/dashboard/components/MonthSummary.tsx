import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "../../../lib/cn";
import { monthName, type YearMonth } from "../../../lib/dates";
import { formatBRL, formatCentsAsDecimal } from "../../../lib/money";
import { cascadeItem } from "../../../lib/motion";
import { REFUNDS_IN_FAVOR } from "../spending";
import type { PeriodTotals } from "../types";

export interface MonthSummaryProps {
  month: YearMonth;
  totals: PeriodTotals;
}

interface FlowProps {
  label: string;
  cents: number;
  icon: LucideIcon;
  /** Cor do rótulo e da seta; o valor fica em tinta comum. */
  tone: string;
  /** O que o valor quer dizer, quando só o número não basta. */
  note?: string;
}

// A partir daqui o número principal não cabe em 320px no tamanho de destaque.
const LONG_VALUE_LENGTH = 11;

function sentence(month: YearMonth, { income_cents, expense_cents, net_cents }: PeriodTotals) {
  const name = monthName(month);
  if (income_cents === 0 && expense_cents === 0) return `Nenhuma entrada ou saída em ${name}.`;
  if (net_cents > 0) return `Em ${name} você recebeu mais do que gastou.`;
  if (net_cents < 0) return `Em ${name} você gastou mais do que recebeu.`;
  return `Em ${name} as entradas e as saídas empataram.`;
}

function Flow({ label, cents, icon: Icon, tone, note }: FlowProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0",
        "sm:block sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0",
      )}
    >
      <dt className={cn("flex items-center gap-1.5 text-label", tone)}>
        <Icon aria-hidden="true" className="size-4" />
        {label}
      </dt>
      <dd className="grid justify-items-end sm:mt-0.5 sm:justify-items-start">
        <span className="money text-money-md text-ink sm:text-money-lg">{formatBRL(cents)}</span>
        {note && <span className="text-small text-ink-muted">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * Resumo do mês (seção 7.1 do design-system.md): o saldo do mês é o número principal da tela,
 * com o traço de marca-texto, e entradas e saídas vêm ao lado, com seta e rótulo. Um número
 * sozinho é um número, e não um gráfico.
 */
export function MonthSummary({ month, totals }: MonthSummaryProps) {
  const value = formatCentsAsDecimal(totals.net_cents);
  const long = value.length >= LONG_VALUE_LENGTH;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end">
      <motion.section variants={cascadeItem} aria-label="Saldo do mês" className="grid gap-1">
        <p className="text-label text-ink-muted">Saldo do mês</p>
        <p
          className={cn(
            "money text-ink",
            long
              ? "text-money-lg sm:text-money-hero lg:text-money-hero-lg"
              : "text-money-hero lg:text-money-hero-lg",
          )}
        >
          <span className="marca-texto before:animate-paint">
            {totals.net_cents < 0 && "−"}
            <span
              className={cn(
                "mr-1.5 font-normal",
                long ? "text-body sm:text-title-2 lg:text-title-1" : "text-title-2 lg:text-title-1",
              )}
            >
              R$
            </span>
            {value}
          </span>
        </p>
        <p className="text-small text-ink-muted">{sentence(month, totals)}</p>
      </motion.section>

      <motion.section
        variants={cascadeItem}
        aria-label="Entradas e saídas"
        className="rounded-lg border border-border bg-surface p-4 sm:p-5"
      >
        <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Flow label="Entradas" cents={totals.income_cents} icon={ArrowUp} tone="text-income" />
          {/* Com mais estornos do que gastos, as saídas ficam negativas: o valor aparece sem
              o sinal de menos, como dinheiro a favor. */}
          <Flow
            label="Saídas"
            cents={Math.abs(totals.expense_cents)}
            icon={ArrowDown}
            tone="text-expense"
            note={totals.expense_cents < 0 ? REFUNDS_IN_FAVOR : undefined}
          />
        </dl>
      </motion.section>
    </div>
  );
}
