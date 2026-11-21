import { paths } from "@web/lib/paths";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SITE_LINK_HINT, openSite } from "@/lib/site";

import { setPendingChallenge } from "../challenge";
import { TwoFactorForm } from "./TwoFactorForm";

/** Segunda etapa da entrada. Quem perdeu o app e os códigos pede a desativação pelo site. */
export function TwoFactorScreen() {
  const router = useRouter();
  const backToLogin = useCallback(() => {
    setPendingChallenge(null);
    router.replace("/entrar");
  }, [router]);

  return (
    <Screen title="Confirme que é você">
      <TwoFactorForm onChallengeMissing={backToLogin} />
      <Button
        variant="ghost"
        label="Perdi o acesso ao aplicativo e aos códigos"
        accessibilityHint={SITE_LINK_HINT}
        onPress={() => void openSite(paths.login)}
      />
      <Button variant="ghost" label="Entrar com outra conta" onPress={backToLogin} />
    </Screen>
  );
}
