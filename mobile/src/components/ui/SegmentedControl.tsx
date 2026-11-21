import { Pressable, StyleSheet, View } from "react-native";

import { TOUCH_TARGET, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Escolha entre poucas opções lado a lado, como Despesa e Receita. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.group, { backgroundColor: colors.bgSunken }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.option,
              selected && { backgroundColor: colors.surface, borderColor: colors.borderStrong },
            ]}
          >
            <Text variant="label" color={selected ? "ink" : "inkMuted"}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", borderRadius: radius.md, padding: space[1], gap: space[1] },
  option: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
});
