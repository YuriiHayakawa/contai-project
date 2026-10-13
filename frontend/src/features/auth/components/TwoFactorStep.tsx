import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage, isApiError } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useTwoFactorLogin } from "../hooks/useTwoFactorLogin";
import type { TwoFactorLocationState } from "../types";
import { AuthLayout } from "./AuthLayout";

type Mode = "app" | "recovery";

// Botão com a aparência de um link, para as ações que ficam na própria tela (trocar de modo,
// pedir a recuperação) em vez de navegar por um endereço.
const linkButton =
  "inline-flex min-h-11 items-center rounded-sm text-left font-bold text-primary underline " +
  "underline-offset-[3px] transition-colors duration-fast ease-out hover:text-primary-hover";

/**
 * Segunda etapa da entrada (FR-012): o código do app autenticador ou, se a pessoa não tiver o
 * celular à mão, um código de recuperação. Quem perdeu os dois pede a desativação por e-mail.
 */
export function TwoFactorStep() {
  const location = useLocation();
  const navigate = useNavigate();
  const complete = useTwoFactorLogin();
  const [mode, setMode] = useState<Mode>("app");
  const [code, setCode] = useState("");

  const state = location.state as TwoFactorLocationState | null;
  // Sem o desafio (link aberto direto ou página recarregada), recomeça pela tela de entrada.
  if (!state?.challengeToken) return <Navigate to={paths.login} replace />;

  const challengeToken = state.challengeToken;
  // O desafio expirou (5 minutos): a pessoa entra de novo com e-mail e senha.
  const challengeExpired = isApiError(complete.error) && complete.error.code === "unauthenticated";

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    complete.mutate(
      mode === "app"
        ? { challenge_token: challengeToken, code: trimmed }
        : { challenge_token: challengeToken, recovery_code: trimmed },
    );
  };

  const switchTo = (next: Mode): void => {
    setMode(next);
    setCode("");
    complete.reset();
  };

  return (
    <AuthLayout
      title="Confirme que é você"
      footer={
        <TextLink to={paths.login} standalone>
          Entrar com outra conta
        </TextLink>
      }
    >
      <Card>
        <form noValidate onSubmit={submit} className="grid gap-4">
          {complete.isError && (
            <Notice kind={challengeExpired ? "warning" : "error"}>
              {challengeExpired
                ? "A entrada demorou demais. Volte e entre de novo com e-mail e senha."
                : errorMessage(complete.error)}
            </Notice>
          )}

          {mode === "app" ? (
            <TextField
              label="Código do aplicativo"
              help="Abra o app autenticador e digite o código de 6 dígitos que ele mostra agora."
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : (
            <TextField
              label="Código de recuperação"
              help="Use um dos códigos que você guardou ao ativar a verificação em duas etapas."
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}

          <Button type="submit" block loading={complete.isPending}>
            Entrar
          </Button>
        </form>
      </Card>

      <div className="grid gap-1 text-body text-ink-muted">
        {mode === "app" ? (
          <button type="button" className={linkButton} onClick={() => switchTo("recovery")}>
            Não estou com o celular: usar um código de recuperação
          </button>
        ) : (
          <button type="button" className={linkButton} onClick={() => switchTo("app")}>
            Voltar ao código do aplicativo
          </button>
        )}
        <button
          type="button"
          className={linkButton}
          onClick={() =>
            void navigate(paths.twoFactorResetRequest, {
              state: { challengeToken, from: state.from } satisfies TwoFactorLocationState,
            })
          }
        >
          Perdi o acesso ao aplicativo e aos códigos
        </button>
      </div>
    </AuthLayout>
  );
}
