import { useReducedMotion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  type LabelProps,
} from "recharts";

import { monthLabel, monthName } from "../../../lib/dates";
import { formatBRL, formatCompactBRL } from "../../../lib/money";
import type { MonthAmount } from "../../dashboard/types";

export interface InstallmentsChartProps {
  /** Parcelas futuras por mês de vencimento, do mais próximo ao mais distante. */
  months: readonly MonthAmount[];
  /** Nome do cartão, para o resumo em texto. */
  cardName: string;
}

const CHART_HEIGHT = 140;
const BAR_MS = 360;

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Parcelas futuras de um cartão (seção 7.4 do design-system.md): uma série por mês em
 * `--chart-single`, sem legenda, com o valor escrito só na maior barra; os demais ficam no
 * tooltip e na tabela.
 */
export function InstallmentsChart({ months, cardName }: InstallmentsChartProps) {
  const reducedMotion = useReducedMotion();
  const largest = Math.max(...months.map((item) => item.amount_cents), 0);
  const first = months[0];
  const last = months.at(-1);
  const summary =
    first && last
      ? `Parcelas futuras do ${cardName}, de ${monthName(first.month)} a ${monthLabel(last.month).toLowerCase()}. ` +
        `A maior soma é ${formatBRL(largest)}.`
      : "";

  const renderLargest = ({ x, y, width, value }: LabelProps) => {
    if (Number(value) !== largest) return null;
    return (
      <text
        x={Number(x) + Number(width) / 2}
        y={Number(y) - 6}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill="var(--ink)"
      >
        {formatCompactBRL(largest)}
      </text>
    );
  };

  return (
    <div>
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={months.map((item) => ({ ...item }))}
            margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              tickFormatter={(month: string) => monthName(month, "short")}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              cursor={{ fill: "var(--bg-sunken)" }}
              isAnimationActive={false}
              content={({ active, label }) => {
                const item = active ? months.find((entry) => entry.month === label) : undefined;
                if (!item) return null;
                return (
                  <div className="rounded-md border border-border bg-surface-raised px-3 py-2 shadow-md">
                    <p className="text-label text-ink">{monthLabel(item.month)}</p>
                    <p className="money text-money-sm text-ink">{formatBRL(item.amount_cents)}</p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="amount_cents"
              fill="var(--chart-single)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={!reducedMotion}
              animationDuration={BAR_MS}
            >
              <LabelList dataKey="amount_cents" content={renderLargest} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-label font-bold text-primary">
          Ver parcelas por mês
        </summary>
        <table className="w-full border-collapse text-small">
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-2 text-left font-semibold">
                Fatura de
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Parcelas
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((item) => (
              <tr key={item.month} className="border-t border-border text-ink">
                <th scope="row" className="py-2 text-left font-normal">
                  {capitalized(monthLabel(item.month))}
                </th>
                <td className="money py-2 text-right">{formatBRL(item.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
