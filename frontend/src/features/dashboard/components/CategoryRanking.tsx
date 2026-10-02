import { motion } from "motion/react";
import { Link } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { CATEGORY_FILL_CLASS, isCategoryColor } from "../../../components/ui/category-colors";
import { cn } from "../../../lib/cn";
import { monthName, type YearMonth } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { barTransition } from "../../../lib/motion";
import { paths } from "../../../lib/paths";
import { listSearch } from "../../transactions/filters";
import type { DashboardCategories } from "../types";

export interface CategoryRankingProps {
  month: YearMonth;
  categories: DashboardCategories;
  /** Abre a folha de novo lançamento, quando o mês ainda não tem despesas. */
  onLaunch: () => void;
}

interface RankingRow {
  key: string;
  name: string;
  icon: string;
  color: string;
  amountCents: number;
  percent: number;
  /** Só na linha "Outras": quantas categorias ela junta. */
  grouped?: number;
  /** Endereço da lista de lançamentos que compõem a linha. */
  to: string;
}

const MAX_ROWS = 6;

const percentFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * No máximo seis linhas: com mais categorias do que isso, ficam as cinco maiores e uma linha
 * "Outras", na cor neutra, com a soma das demais.
 */
function rankingRows(month: YearMonth, { items, total_cents }: DashboardCategories): RankingRow[] {
  const list = `${paths.transactions}`;
  const shown = items.length > MAX_ROWS ? items.slice(0, MAX_ROWS - 1) : items;
  const rows: RankingRow[] = shown.map((item) => ({
    key: item.category_id,
    name: item.name,
    icon: item.icon,
    color: item.color,
    amountCents: item.amount_cents,
    percent: item.percent,
    to: `${list}${listSearch(month, { category: item.category_id })}`,
  }));
  const rest = items.slice(shown.length);
  if (rest.length > 0) {
    const amountCents = rest.reduce((total, item) => total + item.amount_cents, 0);
    rows.push({
      key: "others",
      name: "Outras",
      icon: "shapes",
      color: "ardosia",
      amountCents,
      // Percentual não é dinheiro: a conta de um décimo pode ser feita em ponto flutuante.
      percent: Math.round((amountCents * 1000) / total_cents) / 10,
      // Diz que é um agrupamento: a categoria "Outros" do usuário usa a mesma cor neutra.
      grouped: rest.length,
      to: `${list}${listSearch(month, { type: "expense" })}`,
    });
  }
  return rows;
}

/**
 * Gastos por categoria (seção 7.2 do design-system.md): lista de barras ordenadas, da maior
 * para a menor, sem rosca nem pizza. Cada linha abre os lançamentos da categoria no mês.
 */
export function CategoryRanking({ month, categories, onLaunch }: CategoryRankingProps) {
  const rows = rankingRows(month, categories);
  const largest = Math.max(...rows.map((row) => row.amountCents), 1);

  return (
    <Card title="Para onde foi o dinheiro">
      {rows.length === 0 ? (
        <div className="grid justify-items-start gap-1">
          <p className="text-body text-ink-muted">Nenhuma despesa em {monthName(month)}.</p>
          <Button variant="ghost" className="-ml-5" onClick={onLaunch}>
            Lançar despesa
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                to={row.to}
                className={cn(
                  "-mx-2 grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-md",
                  "px-2 py-3 transition-colors duration-fast ease-out hover:bg-bg-sunken",
                )}
              >
                <CategoryChip color={row.color} icon={row.icon} />
                <span className="grid min-w-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body font-bold text-ink">{row.name}</span>
                    <span className="money text-money-md text-ink">
                      {formatBRL(row.amountCents)}
                    </span>
                  </span>
                  <span className="mt-1.5 mb-1 block h-2 rounded-full bg-bg-sunken">
                    <motion.span
                      className={cn(
                        "block h-full origin-left rounded-full",
                        CATEGORY_FILL_CLASS[isCategoryColor(row.color) ? row.color : "ardosia"],
                      )}
                      // Proporcional à maior categoria; a largura é medida, e não cor.
                      style={{ width: `${Math.max((row.amountCents / largest) * 100, 2)}%` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={barTransition}
                    />
                  </span>
                  <span className="text-small text-ink-muted">
                    {percentFormat.format(row.percent)}% dos gastos
                    {row.grouped && ` · ${row.grouped} categorias`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
