import { paths } from "@web/lib/paths";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useLogout } from "@/features/auth/hooks/useLogout";
import { SITE_LINK_HINT, type SitePath, openSite } from "@/lib/site";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

// As ações de conta ficam no site até a P3 (FR-006). As configurações do site são uma página
// só, com as seções em abas: todos os atalhos de conta abrem nela.
const SITE_ACTIONS: { label: string; path: SitePath }[] = [
  { label: "Ativar ou desativar as duas etapas", path: paths.settings },
  { label: "Ver os aparelhos conectados", path: paths.settings },
  { label: "Exportar meus dados", path: paths.settings },
  { label: "Excluir minha conta", path: paths.settings },
];

/** "Mais": sair da conta e os atalhos para o que se faz pelo site. */
export function MoreScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const logout = useLogout();
  const [confirming, setConfirming] = useState(false);

  return (
    <Screen title="Mais">
      <Button
        label="Conectar à Siri"
        variant="secondary"
        accessibilityHint="Gera o token e mostra como montar o atalho."
        onPress={() => router.push("/siri")}
      />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="title3" accessibilityRole="header">
          Conta, pelo site
        </Text>
        <Text variant="small" color="inkMuted">
          Estas opções abrem o site do Contaí no navegador, já na sua conta depois de entrar.
        </Text>
        {SITE_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant="ghost"
            label={action.label}
            accessibilityHint={SITE_LINK_HINT}
            onPress={() => void openSite(action.path)}
          />
        ))}
      </View>

      <Button label="Sair da conta" variant="secondary" onPress={() => setConfirming(true)} />

      <ConfirmDialog
        open={confirming}
        title="Sair da conta neste iPhone?"
        description="Para usar o app de novo, você vai precisar entrar com e-mail e senha. O atalho da Siri continua funcionando."
        confirmLabel="Sair"
        loading={logout.isPending}
        onConfirm={() => logout.mutate(undefined, { onSettled: () => setConfirming(false) })}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[2] },
});
