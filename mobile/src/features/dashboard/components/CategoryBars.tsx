import type { CategorySpending } from "@web/features/dashboard/types";
import { formatBRL } from "@web/lib/money";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { spokenBRL } from "@/lib/spoken-money";
import { TOUCH_TARGET, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** O que se diz das saídas de uma categoria quando os estornos passaram do que foi gasto. */
export const REFUNDS_IN_FAVOR = "a seu favor, de estornos";

const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export interface CategoryBarsProps {
  /** Da categoria com mais gasto para a com menos, como a API devolve. */
  items: CategorySpending[];
  onSelect: (categoryId: string) => void;
}

/**
 * Gastos por categoria em barras ordenadas (design-system, seção 7.2), feitas com `View`, sem
 * biblioteca. O percentual vem da API; o app só mede a largura de cada barra pela maior.
 */
export function CategoryBars({ items, onSelect }: CategoryBarsProps) {
  const { colors } = useTheme();
  const largest = Math.max(0, ...items.map((item) => item.amount_cents));

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const inFavor = item.amount_cents < 0;
        const width = largest > 0 && !inFavor ? Math.round((item.amount_cents / largest) * 100) : 0;
        const value = inFavor
          ? `${formatBRL(-item.amount_cents)} ${REFUNDS_IN_FAVOR}`
          : formatBRL(item.amount_cents);
        const spoken = inFavor
          ? `${item.name}, ${spokenBRL(-item.amount_cents)} ${REFUNDS_IN_FAVOR}`
          : `${item.name}, ${spokenBRL(item.amount_cents)}, ${percentFormat.format(item.percent)}% das saídas`;
        return (
          <Pressable
            key={item.category_id}
            accessibilityRole="button"
            accessibilityLabel={spoken}
            accessibilityHint="Abre os lançamentos desta categoria."
            onPress={() => onSelect(item.category_id)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}
          >
            <View style={styles.labels}>
              <Text variant="label" style={styles.name}>
                {item.name}
              </Text>
              <Text variant="moneySm">{value}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.bgSunken }]}>
              <View
                testID={`bar-${item.category_id}`}
                style={[styles.bar, { backgroundColor: colors.primary, width: `${width}%` }]}
              />
            </View>
            {!inFavor && (
              <Text variant="micro" color="inkMuted">
                {percentFormat.format(item.percent)}% das saídas
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[2] },
  row: {
    minHeight: TOUCH_TARGET,
    paddingVertical: space[2],
    gap: space[1],
    borderRadius: radius.sm,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: space[2],
  },
  name: { flexShrink: 1 },
  track: { height: 10, borderRadius: radius.full, overflow: "hidden" },
  bar: { height: "100%", borderRadius: radius.full },
});
