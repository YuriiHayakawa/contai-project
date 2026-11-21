import { paths } from "@web/lib/paths";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { SITE_LINK_HINT, openSite } from "@/lib/site";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

export interface FirstStepsProps {
  hasAccount: boolean;
  onLaunch: () => void;
}

/** Primeira vez, sem lançamentos: o que fazer, como no site. */
export function FirstSteps({ hasAccount, onLaunch }: FirstStepsProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title2" accessibilityRole="header">
        Primeiros passos
      </Text>
      <View style={styles.step}>
        <Text variant="bodyStrong">Cadastre uma conta</Text>
        <Text variant="body" color="inkMuted">
          Pode ser a conta do banco, um cartão de crédito ou o dinheiro da carteira. As contas são
          cadastradas pelo site.
        </Text>
        {!hasAccount && (
          <Button
            variant="secondary"
            label="Cadastrar conta no site"
            accessibilityHint={SITE_LINK_HINT}
            onPress={() => void openSite(paths.accounts)}
          />
        )}
      </View>
      <View style={styles.step}>
        <Text variant="bodyStrong">Faça seu primeiro lançamento</Text>
        <Text variant="body" color="inkMuted">
          Anote uma despesa ou uma receita. O saldo da conta se ajusta na hora.
        </Text>
        {hasAccount && <Button label="Lançar um gasto" onPress={onLaunch} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[4] },
  step: { gap: space[2] },
});
