import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { useSession } from "../SessionProvider";

const RESTORE_ERROR_MESSAGE =
  "Não foi possível falar com o servidor para abrir sua conta. Confira sua conexão e tente de " +
  "novo. Você continua conectado.";

/**
 * Guard único das rotas do app: sem sessão, leva à entrada; enquanto a sessão guardada é
 * conferida na abertura, não mostra nem o app nem a entrada.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, restoreError, retryRestore } = useSession();
  const { colors } = useTheme();

  if (status === "signedOut") return <Redirect href="/entrar" />;
  if (status === "signedIn") return children;

  return (
    <View style={[styles.waiting, { backgroundColor: colors.bg }]}>
      {restoreError ? (
        <ErrorState
          title="Não deu para abrir o Contaí"
          message={RESTORE_ERROR_MESSAGE}
          onRetry={retryRestore}
        />
      ) : (
        <LoadingState message="Abrindo o Contaí…" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  waiting: { flex: 1, justifyContent: "center", padding: space[4] },
});
