import { type YearMonth, monthLabel, yearMonthOf } from "@web/lib/dates";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Text } from "@/components/ui/Text";
import { errorMessage } from "@/lib/api-client";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { useAccounts } from "../../accounts/hooks/useAccounts";
import { categoriesById, useCategories } from "../../categories/hooks/useCategories";
import { useTransactions } from "../hooks/useTransactions";
import { useUndoVoice } from "../hooks/useUndoVoice";
import { MonthSwitcher } from "./MonthSwitcher";
import { TransactionList } from "./TransactionList";

/** Parâmetros da rota: o painel abre a lista já num mês e numa categoria. */
export interface TransactionsRouteParams {
  mes?: string;
  categoria?: string;
  [key: string]: string | undefined;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Lançamentos do mês (FR-010), com o filtro de categoria vindo do painel (FR-008). */
export function TransactionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<TransactionsRouteParams>();
  const [month, setMonth] = useState<YearMonth>(
    params.mes && MONTH_PATTERN.test(params.mes) ? params.mes : yearMonthOf(),
  );
  // A aba pode já estar aberta quando o painel manda outro mês: o mês acompanha o parâmetro.
  const [monthParam, setMonthParam] = useState(params.mes);
  if (params.mes !== monthParam) {
    setMonthParam(params.mes);
    if (params.mes && MONTH_PATTERN.test(params.mes)) setMonth(params.mes);
  }
  const categoryId = params.categoria ?? null;

  const transactions = useTransactions(month, categoryId);
  const accounts = useAccounts();
  const categories = useCategories();
  const undo = useUndoVoice();
  const pull = usePullToRefresh(transactions.refetch);
  useRefetchOnFocus(transactions.refetch);

  const categoryName =
    categoryId && categories.data ? categoriesById(categories.data).get(categoryId)?.label : null;
  const clearFilter = () => router.setParams({ categoria: undefined });

  const header = (
    <View style={styles.header}>
      <Text variant="title1" accessibilityRole="header">
        Lançamentos
      </Text>
      <MonthSwitcher month={month} onChange={setMonth} />
      {categoryId && (
        <View style={[styles.filter, { backgroundColor: colors.primarySoft }]}>
          <Text variant="label" style={styles.filterText}>
            Só {categoryName ?? "a categoria escolhida"}
          </Text>
          <Button compact variant="ghost" label="Ver todas" onPress={clearFilter} />
        </View>
      )}
    </View>
  );

  const error = transactions.error ?? accounts.error ?? categories.error;
  const loading = transactions.isPending || accounts.isPending || categories.isPending;

  let empty = null;
  if (loading) {
    empty = <LoadingState message="Carregando os lançamentos…" />;
  } else if (error) {
    empty = (
      <ErrorState
        message={errorMessage(error)}
        onRetry={() => {
          void transactions.refetch();
          void accounts.refetch();
          void categories.refetch();
        }}
      />
    );
  } else if (categoryId) {
    empty = (
      <EmptyState
        title="Nada nesta categoria"
        description={`Não há lançamentos de ${categoryName ?? "esta categoria"} em ${monthLabel(month).toLowerCase()}.`}
        actionLabel="Ver todas as categorias"
        onAction={clearFilter}
      />
    );
  } else {
    empty = (
      <EmptyState
        title="Nenhum lançamento neste mês"
        description={`Os gastos e as entradas de ${monthLabel(month).toLowerCase()} aparecem aqui.`}
        actionLabel="Lançar um gasto"
        onAction={() => router.push("/lancamento/novo")}
      />
    );
  }

  const ready = !loading && !error && accounts.data && categories.data;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <TransactionList
        items={ready ? transactions.items : []}
        accounts={accounts.data ?? []}
        categories={categories.data ?? { expense: [], income: [] }}
        onOpen={(item) => router.push(`/lancamento/${item.id}`)}
        onUndo={(item) => undo.mutate(item)}
        undoingId={undo.isPending ? (undo.variables?.id ?? null) : null}
        header={header}
        empty={empty}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        loadingMore={transactions.isFetchingNextPage}
        onEndReached={() => {
          if (transactions.hasNextPage && !transactions.isFetchingNextPage) {
            void transactions.fetchNextPage();
          }
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Lançar"
        accessibilityHint="Abre o formulário de um lançamento novo."
        onPress={() => router.push("/lancamento/novo")}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: pressed ? colors.primaryHover : colors.primary },
        ]}
      >
        <Text variant="bodyStrong" style={{ color: colors.onPrimary }}>
          + Lançar
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: space[4], paddingTop: space[4], paddingBottom: space[2] },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    paddingLeft: space[3],
  },
  filterText: { flex: 1 },
  fab: {
    position: "absolute",
    right: space[4],
    bottom: space[4],
    minHeight: 56,
    minWidth: 56,
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
