import { useReducedMotion } from "motion/react";
import type { MouseEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { monthLabel, monthName, type YearMonth } from "../../../lib/dates";
import { formatBRL, formatCompactBRL } from "../../../lib/money";
import type { MonthTotals } from "../types";

export interface TrendChartProps {
  /** Um item por mês, do mais antigo para o mais novo. */
  trend: readonly MonthTotals[];
  /** Mês exibido no painel: o rótulo dele fica em destaque no eixo. */
  month: YearMonth;
  /** Tocar em um mês do gráfico muda o mês do painel. */
  onSelectMonth: (month: YearMonth) => void;
}

interface MonthTickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
}

interface TrendTooltipProps {
  item: MonthTotals | undefined;
}

const CHART_HEIGHT = 200;
// Cabe a maior marca do eixo ("R$ 150 mil") sem cortar a primeira letra.
const Y_AXIS_WIDTH = 76;
const TICK_INTERVALS = 3;
const NICE_STEPS = [1, 2, 2.5, 5, 10];
const BAR_MS = 360;

/** Três intervalos em valores redondos que cobrem o maior valor: "R$ 2 mil", "R$ 4 mil"… */
function axisTicks(maxCents: number): number[] {
  const rough = maxCents / TICK_INTERVALS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const nice = NICE_STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10;
  const step = Math.round(nice * magnitude);
  return Array.from({ length: TICK_INTERVALS + 1 }, (_, index) => index * step);
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function summaryOf(trend: readonly MonthTotals[], selected: MonthTotals | undefined): string {
  const first = trend[0];
  const last = trend.at(-1);
  if (!first || !last) return "Sem meses para mostrar.";
  const range = `Entradas e saídas de ${monthName(first.month)} a ${monthLabel(last.month).toLowerCase()}.`;
  if (!selected) return range;
  return (
    `${range} Em ${monthName(selected.month)}: entradas de ${formatBRL(selected.income_cents)} ` +
    `e saídas de ${formatBRL(selected.expense_cents)}.`
  );
}

function TrendTooltip({ item }: TrendTooltipProps) {
  if (!item) return null;
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2 shadow-md">
      <p className="text-label text-ink">{monthLabel(item.month)}</p>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-4 text-small text-ink-muted">
        <dt>Entradas</dt>
        <dd className="money text-right text-money-sm text-ink">{formatBRL(item.income_cents)}</dd>
        <dt>Saídas</dt>
        <dd className="money text-right text-money-sm text-ink">{formatBRL(item.expense_cents)}</dd>
        <dt>Saldo</dt>
        <dd className="money text-right text-money-sm text-ink">{formatBRL(item.net_cents)}</dd>
      </dl>
    </div>
  );
}

/**
 * Evolução de entradas e saídas (seções 7.1 e 7.3 do design-system.md): barras agrupadas por
 * mês, com legenda, tooltip e os mesmos dados em tabela. O Recharts só é carregado com este
 * componente.
 */
export function TrendChart({ trend, month, onSelectMonth }: TrendChartProps) {
  const reducedMotion = useReducedMotion();
  const selected = trend.find((item) => item.month === month);
  const largest = Math.max(...trend.flatMap((item) => [item.income_cents, item.expense_cents]), 0);

  if (largest === 0) {
    return <p className="text-body text-ink-muted">Sem entradas nem saídas nestes meses.</p>;
  }

  const ticks = axisTicks(largest);
  const data = trend.map((item) => ({ ...item }));

  const renderMonthTick = ({ x, y, payload }: MonthTickProps) => {
    if (!payload) return null;
    const current = payload.value === month;
    return (
      <text
        x={x}
        y={y}
        dy={14}
        textAnchor="middle"
        fontSize={12}
        fontWeight={current ? 700 : 600}
        fill={current ? "var(--ink)" : "var(--ink-subtle)"}
      >
        {monthName(payload.value, "short")}
      </text>
    );
  };

  // O mês tocado sai da posição do toque, e não do estado de "passar o ponteiro" do Recharts,
  // que em tela de toque ainda não existe no primeiro toque. Cada mês ocupa uma faixa igual da
  // área à direita do eixo. Quem usa teclado troca o mês pela tabela ou pelo título do painel.
  const selectMonthAt = (event: MouseEvent<HTMLDivElement>): void => {
    const area = event.currentTarget.getBoundingClientRect();
    const plotWidth = area.width - Y_AXIS_WIDTH;
    const position = event.clientX - area.left - Y_AXIS_WIDTH;
    if (plotWidth <= 0 || position < 0) return;
    const index = Math.min(Math.floor((position / plotWidth) * trend.length), trend.length - 1);
    const tapped = trend[index];
    if (tapped) onSelectMonth(tapped.month);
  };

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-4 text-small text-ink">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-chart-income" />
          Entradas
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-chart-expense" />
          Saídas
        </li>
      </ul>

      <div
        role="img"
        aria-label={summaryOf(trend, selected)}
        onClick={selectMonthAt}
        className="cursor-pointer [&_.recharts-surface]:outline-none"
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="22%"
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={renderMonthTick}
            />
            <YAxis
              width={Y_AXIS_WIDTH}
              axisLine={false}
              tickLine={false}
              ticks={ticks}
              domain={[0, ticks.at(-1) ?? largest]}
              tickFormatter={formatCompactBRL}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip
              cursor={{ fill: "var(--bg-sunken)" }}
              isAnimationActive={false}
              content={({ active, label }) => (
                <TrendTooltip
                  item={active ? trend.find((item) => item.month === label) : undefined}
                />
              )}
            />
            <Bar
              dataKey="income_cents"
              name="Entradas"
              fill="var(--chart-income)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={!reducedMotion}
              animationDuration={BAR_MS}
            />
            <Bar
              dataKey="expense_cents"
              name="Saídas"
              fill="var(--chart-expense)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={!reducedMotion}
              animationDuration={BAR_MS}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-label font-bold text-primary">
          Ver como tabela
        </summary>
        <table className="w-full border-collapse text-small">
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-2 text-left font-semibold">
                Mês
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Entradas
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Saídas
              </th>
            </tr>
          </thead>
          <tbody>
            {trend.map((item) => (
              <tr key={item.month} className="border-t border-border text-ink">
                <th scope="row" className="text-left font-normal">
                  <button
                    type="button"
                    aria-current={item.month === month ? "true" : undefined}
                    onClick={() => onSelectMonth(item.month)}
                    className="inline-flex min-h-11 items-center rounded-sm text-left underline underline-offset-[3px] aria-[current]:font-bold aria-[current]:no-underline"
                  >
                    {capitalized(monthName(item.month))}
                  </button>
                </th>
                <td className="money py-2 text-right">{formatBRL(item.income_cents)}</td>
                <td className="money py-2 text-right">{formatBRL(item.expense_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
