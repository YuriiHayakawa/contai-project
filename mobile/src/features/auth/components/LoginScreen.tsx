import { paths } from "@web/lib/paths";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { SITE_LINK_HINT, openSite } from "@/lib/site";
import { space } from "@/theme/tokens";

import { SIGN_OUT_MESSAGES, useSession } from "../SessionProvider";
import { LoginForm } from "./LoginForm";

/** Entrada no app. A conta é criada e a senha é recuperada pelo site (FR-006). */
export function LoginScreen() {
  const router = useRouter();
  const { lastSignOutReason } = useSession();
  const reason = lastSignOutReason ? SIGN_OUT_MESSAGES[lastSignOutReason] : null;

  return (
    <Screen title="Entrar no Contaí">
      <Text variant="body" color="inkMuted">
        Use o mesmo e-mail e a mesma senha do site.
      </Text>
      {reason && <Notice kind="warning">{reason}</Notice>}
      <LoginForm onTwoFactor={() => router.push("/duas-etapas")} />
      <View style={styles.links}>
        <Button
          variant="ghost"
          label="Esqueci a senha"
          accessibilityHint={SITE_LINK_HINT}
          onPress={() => void openSite(paths.forgotPassword)}
        />
        <Button
          variant="ghost"
          label="Criar conta"
          accessibilityHint={SITE_LINK_HINT}
          onPress={() => void openSite(paths.register)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: { gap: space[1] },
});
