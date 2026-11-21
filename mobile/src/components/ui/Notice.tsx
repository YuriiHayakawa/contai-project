import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export type NoticeKind = "info" | "success" | "warning" | "error";

export interface NoticeProps {
  kind?: NoticeKind;
  children: string;
  /** Uma ação ligada ao aviso, como "Reenviar o link". */
  action?: ReactNode;
}

const ICONS: Record<NoticeKind, string> = { info: "ℹ", success: "✓", warning: "!", error: "✕" };

/**
 * Aviso em bloco, com ícone e texto: a cor nunca é o único sinal (design-system, seção 2.2). O
 * VoiceOver lê o aviso assim que ele aparece.
 */
export function Notice({ kind = "info", children, action }: NoticeProps) {
  const { colors } = useTheme();
  const tone = {
    info: { background: colors.primarySoft, accent: colors.primary },
    success: { background: colors.incomeSoft, accent: colors.income },
    warning: { background: colors.warningSoft, accent: colors.warning },
    error: { background: colors.dangerSoft, accent: colors.danger },
  }[kind];

  return (
    <View style={[styles.box, { backgroundColor: tone.background }]}>
      <View style={styles.row}>
        <Text
          variant="bodyStrong"
          style={{ color: tone.accent }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {ICONS[kind]}
        </Text>
        <Text
          variant="body"
          style={styles.message}
          accessibilityRole={kind === "error" || kind === "warning" ? "alert" : "text"}
          accessibilityLiveRegion="polite"
        >
          {children}
        </Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space[3], gap: space[2] },
  row: { flexDirection: "row", gap: space[2] },
  message: { flex: 1 },
});
