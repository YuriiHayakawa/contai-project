import { Card } from "../../../components/ui/Card";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { TextLink } from "../../../components/ui/TextLink";
import { dayLabel, monthName, type YearMonth } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { paths } from "../../../lib/paths";
import type { CategoryOption } from "../../categories/hooks/useCategories";
import { listSearch } from "../../transactions/filters";
import type { Transaction } from "../../transactions/types";

export interface TopExpensesProps {
  month: YearMonth;
  /** Da maior despesa para a menor. */
  expenses: readonly Transaction[];
  /** Categorias por id, para o selo e o nome; vazio enquanto elas carregam. */
  categories: ReadonlyMap<string, CategoryOption>;
}

/** Maiores gastos do mês (FR-057), com o caminho para a lista de despesas do mesmo mês. */
export function TopExpenses({ month, expenses, categories }: TopExpensesProps) {
  return (
    <Card
      title="Maiores gastos"
      action={
        expenses.length > 0 && (
          <TextLink
            to={`${paths.transactions}${listSearch(month, { type: "expense" })}`}
            standalone
            className="text-small"
          >
            Ver despesas
          </TextLink>
        )
      }
    >
      {expenses.length === 0 ? (
        <p className="text-body text-ink-muted">Nenhuma despesa em {monthName(month)}.</p>
      ) : (
        <ol className="divide-y divide-border">
          {expenses.map((expense) => {
            const category = expense.category_id ? categories.get(expense.category_id) : undefined;
            return (
              <li key={expense.id} className="flex min-h-14 items-center gap-3 py-2">
                <CategoryChip
                  color={category?.category.color ?? "ardosia"}
                  icon={category?.category.icon ?? ""}
                />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-body font-bold text-ink">
                    {expense.description}
                  </span>
                  <span className="truncate text-small text-ink-muted">
                    {[category?.category.name, dayLabel(expense.date)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="money text-money-md text-ink">
                  {formatBRL(-expense.amount_cents)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
