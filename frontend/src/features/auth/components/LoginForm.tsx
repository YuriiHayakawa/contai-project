import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage, isApiError } from "../../../lib/api-client";
import { paths, type LoginLocationState } from "../../../lib/paths";
import { useLogin } from "../hooks/useLogin";
import { useResendVerification } from "../hooks/useResendVerification";
import { loginSchema, type LoginFormValues } from "../schemas";
import type { TwoFactorLocationState } from "../types";

/**
 * Formulário de entrada. Ao entrar, a sessão começa no `AuthProvider`; quem leva a pessoa
 * para a tela seguinte é a rota. A conta com e-mail ainda não confirmado pode pedir, daqui
 * mesmo, um novo link de confirmação.
 */
export function LoginForm() {
  const login = useLogin();
  const resend = useResendVerification();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    register: field,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const emailNotVerified = isApiError(login.error) && login.error.code === "email_not_verified";

  const submit = handleSubmit((values) => {
    resend.reset();
    login.mutate(
      { email: values.email, password: values.password },
      {
        onSuccess: ({ challengeToken }) => {
          if (!challengeToken) return; // sem segunda etapa: o guard leva adiante
          const from = (location.state as LoginLocationState | null)?.from;
          const state: TwoFactorLocationState = { challengeToken, from };
          void navigate(paths.twoFactorLogin, { state });
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {login.isError && !resend.isSuccess && (
        <Notice
          kind={emailNotVerified ? "warning" : "error"}
          action={
            emailNotVerified && (
              <Button
                variant="ghost"
                className="-ml-5"
                loading={resend.isPending}
                onClick={() => resend.mutate(getValues("email"))}
              >
                Reenviar o link
              </Button>
            )
          }
        >
          {errorMessage(login.error)}
        </Notice>
      )}
      {resend.isSuccess && <Notice kind="success">{resend.data.message}</Notice>}
      {resend.isError && <Notice kind="error">{errorMessage(resend.error)}</Notice>}

      <TextField
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        error={errors.email?.message}
        {...field("email")}
      />
      <div className="grid gap-1">
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...field("password")}
        />
        <p>
          <TextLink to={paths.forgotPassword} standalone>
            Esqueci minha senha
          </TextLink>
        </p>
      </div>
      <Button type="submit" block loading={login.isPending}>
        Entrar
      </Button>
    </form>
  );
}
