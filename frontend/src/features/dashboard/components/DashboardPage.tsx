import { motion } from "motion/react";
import { Suspense, lazy, useMemo } from "react";
import { useSearchParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageSkeleton } from "../../../components/layout/PageSkeleton";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Skeleton } from "../../../components/ui/Skeleton";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { monthName, yearMonthOf, type YearMonth } from "../../../lib/dates";
import { cascade, cascadeItem } from "../../../lib/motion";
import { useAuth } from "../../auth/hooks/useAuth";
import {
  categoriesById,
  useCategories,
  type CategoryOption,
} from "../../categories/hooks/useCategories";
import { useNewTransaction } from "../../transactions/hooks/useNewTransaction";
import { useDashboard } from "../hooks/useDashboard";
import { TREND_MONTHS } from "../services/dashboardService";
import { AccountsCard } from "./AccountsCard";
import { CategoryRanking } from "./CategoryRanking";
import { FirstSteps } from "./FirstSteps";
import { MonthSummary } from "./MonthSummary";
import { PeriodPicker } from "./PeriodPicker";
import { TopExpenses } from "./TopExpenses";

// O gráfico traz o Recharts: fica em um arquivo próprio, carregado depois dos números.
const TrendChart = lazy(() =>
  import("./TrendChart").then((module) => ({ default: module.TrendChart })),
);

/** Parâmetro do endereço com o mês exibido; sem ele, vale o mês atual. */
const MONTH_PARAM = "mes";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Painel: a tela inicial. Mostra o resumo do mês, os gastos por categoria, a evolução de seis
 * meses, o saldo das contas e os maiores gastos; quem ainda não tem lançamentos vê os primeiros
 * passos. A entrada é o único momento orquestrado do app (seção 9.2 do design-system.md): os
 * cartões sobem em cascata e, depois, o marca-texto é pintado atrás do saldo do mês.
 */
export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const openNewTransaction = useNewTransaction();
  const categories = useCategories();

  const currentMonth = yearMonthOf();
  const requested = params.get(MONTH_PARAM);
  const month: YearMonth = requested && MONTH_PATTERN.test(requested) ? requested : currentMonth;
  const dashboard = useDashboard(month);

  const categoriesMap = useMemo(
    () => (categories.data ? categoriesById(categories.data) : new Map<string, CategoryOption>()),
    [categories.data],
  );

  const changeMonth = (next: YearMonth): void => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      // O mês atual é o padrão: não precisa de nada no endereço.
      if (next === currentMonth) updated.delete(MONTH_PARAM);
      else updated.set(MONTH_PARAM, next);
      return updated;
    });
  };

  if (dashboard.status === "loading") return <PageSkeleton wide />;

  if (dashboard.status === "error") {
    return (
      <PageContent wide>
        <EmptyState
          kind="error"
          title="Não foi possível carregar o painel"
          description={errorMessage(dashboard.error)}
          onAction={dashboard.retry}
        />
      </PageContent>
    );
  }

  const { summary, trend, topExpenses } = dashboard;

  if (dashboard.status === "welcome") {
    const firstName = user?.name.trim().split(/\s+/)[0];
    return (
      <PageContent>
        <header className="mb-5">
          <h1 className="font-display text-display text-ink lg:text-display-lg">
            {firstName ? `Boas-vindas, ${firstName}` : "Boas-vindas"}
          </h1>
          <p className="mt-2 text-body text-ink-muted">
            O Contaí é a sua caderneta de contas. Em poucos passos ela começa a mostrar para onde
            vai o seu dinheiro.
          </p>
        </header>
        <div className="grid gap-6">
          <FirstSteps hasAccount={summary.accounts.length > 0} onLaunch={openNewTransaction} />
          {summary.accounts.length > 0 && <AccountsCard accounts={summary.accounts} />}
        </div>
      </PageContent>
    );
  }

  return (
    <PageContent wide>
      <PeriodPicker month={month} onChange={changeMonth} />

      <motion.div
        variants={cascade}
        initial="hidden"
        animate="visible"
        aria-busy={dashboard.isUpdating || undefined}
        className={cn(
          "grid gap-6 transition-opacity duration-fast ease-out",
          // Ao trocar de mês, os números anteriores ficam esmaecidos até os novos chegarem.
          dashboard.isUpdating && "opacity-60",
        )}
      >
        <MonthSummary month={summary.month} totals={summary} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
          <motion.div variants={cascadeItem}>
            <CategoryRanking
              month={dashboard.categories.month}
              categories={dashboard.categories}
              onLaunch={openNewTransaction}
            />
          </motion.div>

          <div className="grid gap-6">
            <motion.div variants={cascadeItem}>
              <Card
                title={
                  month === currentMonth
                    ? `Últimos ${TREND_MONTHS} meses`
                    : `${TREND_MONTHS} meses até ${monthName(month)}`
                }
              >
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <TrendChart trend={trend.items} month={month} onSelectMonth={changeMonth} />
                </Suspense>
              </Card>
            </motion.div>
            <motion.div variants={cascadeItem}>
              <AccountsCard accounts={summary.accounts} />
            </motion.div>
            <motion.div variants={cascadeItem}>
              <TopExpenses
                month={topExpenses.month}
                expenses={topExpenses.items}
                categories={categoriesMap}
              />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </PageContent>
  );
}
