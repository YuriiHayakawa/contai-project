import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** Marca "por voz" nos lançamentos da Siri (FR-028): texto, e não só a cor. */
export function VoiceBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
      <Text variant="micro" color="primary">
        por voz
      </Text>
    </View>
  );
}

/** "Você disse: “gastei 45 no ifood”": a frase que a Siri entendeu. */
export function voicePhraseLabel(phrase: string): string {
  return `Você disse: “${phrase}”`;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
});
