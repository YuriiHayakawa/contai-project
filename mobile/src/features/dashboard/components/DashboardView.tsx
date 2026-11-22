import { type YearMonth, yearMonthOf } from "@web/lib/dates";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { errorMessage } from "@/lib/api-client";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { MonthSwitcher } from "../../transactions/components/MonthSwitcher";
import { VoiceHighlights } from "../../transactions/components/VoiceHighlights";
import { useDashboard } from "../hooks/useDashboard";
import { AccountBalances } from "./AccountBalances";
import { CategoryBars } from "./CategoryBars";
import { FirstSteps } from "./FirstSteps";
import { MonthSummary } from "./MonthSummary";

/**
 * O painel (US5): na ordem, o que a Siri lançou, o mês, o resumo, as categorias e as contas.
 * Os números vêm prontos da API e são os mesmos do site (SC-008).
 */
export function DashboardView() {
  const router = useRouter();
  const { colors } = useTheme();
  const [month, setMonth] = useState<YearMonth>(yearMonthOf());
  const dashboard = useDashboard(month);
  const pull = usePullToRefresh(dashboard.refetch);

  let content;
  if (dashboard.status === "loading") {
    content = <LoadingState message="Carregando o painel…" />;
  } else if (dashboard.status === "error") {
    content = (
      <ErrorState
        title="Não foi possível carregar o painel"
        message={errorMessage(dashboard.error)}
        onRetry={() => void dashboard.refetch()}
      />
    );
  } else if (dashboard.status === "welcome") {
    content = (
      <FirstSteps
        hasAccount={dashboard.summary.accounts.length > 0}
        onLaunch={() => router.push("/lancamento/novo")}
      />
    );
  } else {
    const { summary, categories } = dashboard;
    content = (
      <>
        <MonthSwitcher month={month} onChange={setMonth} />
        <MonthSummary totals={summary} />
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="title3" accessibilityRole="header">
            Gastos por categoria
          </Text>
          {categories.items.length === 0 ? (
            <EmptyState
              title="Nenhum gasto neste mês"
              description="Quando você lançar uma despesa, ela aparece aqui, na categoria dela."
              actionLabel="Lançar um gasto"
              onAction={() => router.push("/lancamento/novo")}
            />
          ) : (
            <CategoryBars
              items={categories.items}
              onSelect={(categoryId) =>
                router.push({
                  pathname: "/lancamentos",
                  params: { categoria: categoryId, mes: month },
                })
              }
            />
          )}
        </View>
        {summary.accounts.length > 0 && <AccountBalances accounts={summary.accounts} />}
      </>
    );
  }

  return (
    <Screen title="Painel" refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <VoiceHighlights />
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[3] },
});
