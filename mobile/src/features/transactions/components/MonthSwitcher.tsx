import { type YearMonth, addMonths, monthLabel } from "@web/lib/dates";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { TOUCH_TARGET, space } from "@/theme/tokens";

export interface MonthSwitcherProps {
  month: YearMonth;
  onChange: (month: YearMonth) => void;
}

/** "‹ Novembro de 2026 ›": troca o mês da lista e do painel. */
export function MonthSwitcher({ month, onChange }: MonthSwitcherProps) {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mês anterior: ${monthLabel(previous)}`}
        onPress={() => onChange(previous)}
        style={styles.arrow}
      >
        <Text variant="title2" color="primary" accessibilityElementsHidden>
          ‹
        </Text>
      </Pressable>
      <Text variant="title3" accessibilityRole="header" style={styles.label}>
        {monthLabel(month)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Próximo mês: ${monthLabel(next)}`}
        onPress={() => onChange(next)}
        style={styles.arrow}
      >
        <Text variant="title2" color="primary" accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  arrow: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, textAlign: "center" },
});
