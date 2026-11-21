import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { errorMessage, isApiError } from "@/lib/api-client";
import { space } from "@/theme/tokens";

import { readPendingChallenge } from "../challenge";
import { useTwoFactorLogin } from "../hooks/useTwoFactorLogin";
import type { TwoFactorMode } from "../types";

const EXPIRED_MESSAGE = "A entrada demorou demais. Volte e entre de novo com e-mail e senha.";
const EMPTY_CODE_MESSAGE = "Digite o código para continuar.";

export interface TwoFactorFormProps {
  /** Sem desafio guardado (app reaberto nesta tela): recomeça pela entrada. */
  onChallengeMissing: () => void;
}

/** Segunda etapa (FR-012): o código do app autenticador ou um código de recuperação. */
export function TwoFactorForm({ onChallengeMissing }: TwoFactorFormProps) {
  const complete = useTwoFactorLogin();
  const [mode, setMode] = useState<TwoFactorMode>("app");
  const [code, setCode] = useState("");
  const [emptyError, setEmptyError] = useState(false);
  const hasChallenge = readPendingChallenge() !== null;

  useEffect(() => {
    if (!hasChallenge) onChallengeMissing();
  }, [hasChallenge, onChallengeMissing]);

  const expired = isApiError(complete.error) && complete.error.code === "unauthenticated";

  const submit = (): void => {
    const trimmed = code.trim();
    if (!trimmed) {
      setEmptyError(true);
      return;
    }
    setEmptyError(false);
    complete.mutate({ mode, code: trimmed });
  };

  const switchTo = (next: TwoFactorMode): void => {
    setMode(next);
    setCode("");
    setEmptyError(false);
    complete.reset();
  };

  if (!hasChallenge) return null;

  return (
    <View style={styles.form}>
      {complete.isError && (
        <Notice kind={expired ? "warning" : "error"}>
          {expired ? EXPIRED_MESSAGE : errorMessage(complete.error)}
        </Notice>
      )}
      {mode === "app" ? (
        <TextField
          key="app"
          label="Código do aplicativo"
          help="Abra o app autenticador e digite o código de 6 dígitos que ele mostra agora."
          error={emptyError ? EMPTY_CODE_MESSAGE : undefined}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          onSubmitEditing={submit}
        />
      ) : (
        <TextField
          key="recovery"
          label="Código de recuperação"
          help="Use um dos códigos que você guardou ao ativar a verificação em duas etapas."
          error={emptyError ? EMPTY_CODE_MESSAGE : undefined}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={submit}
        />
      )}
      <Button label="Entrar" loading={complete.isPending} onPress={submit} />
      {mode === "app" ? (
        <Button
          variant="ghost"
          label="Não estou com o celular: usar um código de recuperação"
          onPress={() => switchTo("recovery")}
        />
      ) : (
        <Button
          variant="ghost"
          label="Voltar ao código do aplicativo"
          onPress={() => switchTo("app")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
});
