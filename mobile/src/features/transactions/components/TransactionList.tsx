import type { Account } from "@web/features/accounts/types";
import type { CategoryTree } from "@web/features/categories/types";
import type { Transaction } from "@web/features/transactions/types";
import type { ReactElement } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from "react-native";

import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { categoriesById } from "../../categories/hooks/useCategories";
import { TransactionRow } from "./TransactionRow";

export interface TransactionListProps {
  items: Transaction[];
  accounts: Account[];
  categories: CategoryTree;
  onOpen: (transaction: Transaction) => void;
  /** Desfaz um lançamento por voz; `undoingId` é o que está sendo desfeito. */
  onUndo?: (transaction: Transaction) => void;
  undoingId?: string | null;
  header: ReactElement;
  empty: ReactElement | null;
  refreshing: boolean;
  onRefresh: () => void;
  loadingMore: boolean;
  onEndReached: () => void;
}

/** A lista do mês, com puxar para atualizar e mais páginas ao chegar no fim. */
export function TransactionList({
  items,
  accounts,
  categories,
  onOpen,
  onUndo,
  undoingId = null,
  header,
  empty,
  refreshing,
  onRefresh,
  loadingMore,
  onEndReached,
}: TransactionListProps) {
  const { colors } = useTheme();
  const categoryLabels = categoriesById(categories);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={empty ?? undefined}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      renderItem={({ item }) => (
        <TransactionRow
          transaction={item}
          categoryLabel={
            item.category_id ? (categoryLabels.get(item.category_id)?.label ?? null) : null
          }
          accountName={accountNames.get(item.account_id) ?? null}
          onPress={() => onOpen(item)}
          onUndo={onUndo ? () => onUndo(item) : undefined}
          undoing={undoingId === item.id}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  // Espaço no fim para o botão "Lançar" não cobrir a última linha.
  content: { paddingHorizontal: space[4], paddingBottom: 96 },
});
