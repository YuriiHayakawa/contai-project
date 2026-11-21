import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WAKING_MESSAGE, useWaking } from "@/lib/waking";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Text } from "./Text";

/** Faixa "Acordando o servidor…", no topo, enquanto uma requisição passa de 4 s. */
export function WakingBanner() {
  const waking = useWaking();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (waking) AccessibilityInfo.announceForAccessibility(WAKING_MESSAGE);
  }, [waking]);

  if (!waking) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        { backgroundColor: colors.warningSoft, paddingTop: insets.top + space[2] },
      ]}
    >
      <Text variant="label" color="ink">
        {WAKING_MESSAGE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: space[4], paddingBottom: space[2] },
});
