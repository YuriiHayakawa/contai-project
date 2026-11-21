import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

export interface ScreenProps {
  children: ReactNode;
  /** Título da página, lido como cabeçalho pelo VoiceOver. */
  title?: string;
  /** Puxar para atualizar. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Sem rolagem, para telas que têm a própria lista. */
  scroll?: boolean;
  edges?: Edge[];
}

/** Moldura de toda tela: fundo do tema, área segura e rolagem, que a fonte grande exige. */
export function Screen({
  children,
  title,
  refreshing = false,
  onRefresh,
  scroll = true,
  edges = ["top", "left", "right"],
}: ScreenProps) {
  const { colors } = useTheme();
  const heading = title ? (
    <Text variant="title1" accessibilityRole="header">
      {title}
    </Text>
  ) : null;

  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.bg }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            ) : undefined
          }
        >
          {heading}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.root]}>
          {heading}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space[4], gap: space[6] },
});
