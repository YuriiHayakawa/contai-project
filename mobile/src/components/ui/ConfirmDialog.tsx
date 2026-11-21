import { type ComponentRef, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  StyleSheet,
  View,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";
import { Text } from "./Text";

export interface ConfirmDialogProps {
  open: boolean;
  /** A pergunta com o objeto: "Excluir este lançamento?". */
  title: string;
  /** A consequência. */
  description: string;
  /** O verbo da ação: "Excluir". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Ação destrutiva: o botão fica na cor de perigo. */
  destructive?: boolean;
  loading?: boolean;
}

/**
 * Confirmação (design-system, seção 6.5): uma folha que sobe da base, com "Cancelar" e o verbo
 * da ação. O VoiceOver começa em "Cancelar", e nada fora da folha é alcançável.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = true,
  loading = false,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const cancelRef = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(cancelRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 300);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          accessibilityRole="button"
          accessibilityLabel="Fechar sem confirmar"
          onPress={onCancel}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceRaised,
              paddingBottom: Math.max(insets.bottom, space[4]),
            },
          ]}
        >
          <Text variant="title2" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="body" color="inkMuted">
            {description}
          </Text>
          <View style={styles.actions}>
            <Button
              label={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              onPress={onConfirm}
            />
            <Button ref={cancelRef} label="Cancelar" variant="secondary" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[6],
    gap: space[3],
    maxHeight: "90%",
  },
  actions: { gap: space[3], marginTop: space[3] },
});
