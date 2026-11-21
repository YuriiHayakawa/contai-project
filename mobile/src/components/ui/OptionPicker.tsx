import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CONTROL_HEIGHT, TOUCH_TARGET, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";
import { Text } from "./Text";

export interface PickerOption {
  value: string;
  label: string;
}

export interface OptionPickerProps {
  /** Rótulo visível acima do campo, e título da lista. */
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}

/**
 * Campo de escolha: mostra a opção atual e abre uma folha com a lista. O VoiceOver lê o rótulo
 * e o valor juntos ("Conta: Nubank"), e cada opção como um botão de rádio.
 */
export function OptionPicker({
  label,
  value,
  options,
  onChange,
  error,
  placeholder = "Escolha",
}: OptionPickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const shown = selected?.label ?? placeholder;

  return (
    <View style={styles.wrapper}>
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={error ?? "Abre a lista para escolher."}
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.borderStrong,
            borderWidth: error ? 2 : 1.5,
          },
        ]}
      >
        <Text variant="body" color={selected ? "ink" : "inkSubtle"} style={styles.value}>
          {shown}
        </Text>
        <Text variant="body" color="inkMuted" accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
      {error && (
        <Text variant="small" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.root}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
            accessibilityRole="button"
            accessibilityLabel="Fechar sem escolher"
            onPress={() => setOpen(false)}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { backgroundColor: colors.surfaceRaised, paddingBottom: insets.bottom + space[4] },
            ]}
          >
            <Text variant="title2" accessibilityRole="header">
              {label}
            </Text>
            <FlatList
              data={options}
              keyExtractor={(option) => option.value}
              accessibilityRole="radiogroup"
              accessibilityLabel={label}
              renderItem={({ item }) => {
                const checked = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ checked }}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.option,
                      { borderBottomColor: colors.border },
                      checked && { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Text variant={checked ? "bodyStrong" : "body"} style={styles.value}>
                      {item.label}
                    </Text>
                    {checked && (
                      <Text variant="bodyStrong" color="primary" accessibilityElementsHidden>
                        ✓
                      </Text>
                    )}
                  </Pressable>
                );
              }}
            />
            <Button label="Fechar" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[2] },
  field: {
    minHeight: CONTROL_HEIGHT,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  value: { flex: 1 },
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "80%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[6],
    gap: space[3],
  },
  option: {
    minHeight: TOUCH_TARGET + 4,
    paddingHorizontal: space[3],
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
  },
});
