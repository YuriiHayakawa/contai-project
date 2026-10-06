import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useResendVerification } from "../hooks/useResendVerification";
import { useVerifyEmail } from "../hooks/useVerifyEmail";
import { emailOnlySchema, type EmailOnlyFormValues } from "../schemas";
import { AuthLayout } from "./AuthLayout";

interface ResendFormProps {
  /** E-mail já conhecido (o do cadastro), para a pessoa não precisar digitar de novo. */
  defaultEmail: string;
}

interface ConfirmingByLinkProps {
  token: string;
}

function emailFromState(state: unknown): string {
  if (typeof state !== "object" || state === null || !("email" in state)) return "";
  return typeof state.email === "string" ? state.email : "";
}

const backToLogin = (
  <>
    Já confirmou?{" "}
    <TextLink to={paths.login} standalone>
      Entrar
    </TextLink>
  </>
);

/** Pede um novo link de confirmação. */
function ResendForm({ defaultEmail }: ResendFormProps) {
  const resend = useResendVerification();
  const {
    register: field,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyFormValues>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: defaultEmail },
  });

  const submit = handleSubmit((values) => resend.mutate(values.email));

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
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
      <Button type="submit" variant="secondary" block loading={resend.isPending}>
        Enviar novo link
      </Button>
    </form>
  );
}

/**
 * Chegada pelo link do e-mail. Abrir a página não confirma nada: a confirmação só acontece no
 * clique do botão. Assim, um verificador automático de links (de um antivírus ou do próprio
 * serviço de e-mail), que abre o endereço antes da pessoa, não gasta o link de uso único.
 */
function ConfirmingByLink({ token }: ConfirmingByLinkProps) {
  const navigate = useNavigate();
  const verification = useVerifyEmail();

  if (verification.isIdle || verification.isPending) {
    return (
      <AuthLayout title="Falta só um passo" footer={backToLogin}>
        <Card>
          <div className="grid gap-4">
            <p className="text-body text-ink">
              Toque no botão para confirmar que este e-mail é seu e ativar a sua conta.
            </p>
            <Button
              block
              loading={verification.isPending}
              onClick={() => verification.mutate(token)}
            >
              Confirmar meu e-mail
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  if (verification.isError) {
    return (
      <AuthLayout title="Não deu para confirmar" footer={backToLogin}>
        <Notice kind="error">{errorMessage(verification.error)}</Notice>
        <Card title="Pedir um novo link">
          <ResendForm defaultEmail="" />
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="E-mail confirmado">
      <Notice kind="success">Sua conta está pronta. Agora é só entrar.</Notice>
      <Button block onClick={() => void navigate(paths.login)}>
        Entrar
      </Button>
    </AuthLayout>
  );
}

/** Depois do cadastro: explica que falta abrir o link e oferece o reenvio. */
function WaitingForConfirmation() {
  const location = useLocation();
  const email = emailFromState(location.state);

  return (
    <AuthLayout title="Confirme seu e-mail" footer={backToLogin}>
      <Card>
        <div className="grid gap-3 text-body text-ink">
          <p>
            Enviamos um link de confirmação
            {email ? (
              <>
                {" "}
                para <strong className="font-bold break-all">{email}</strong>
              </>
            ) : (
              " para o seu e-mail"
            )}
            . Abra o e-mail e toque no link para ativar a sua conta.
          </p>
          <p className="text-ink-muted">
            O link vale por 24 horas. Se o e-mail não chegar em alguns minutos, confira a caixa de
            spam ou peça um novo link.
          </p>
        </div>
      </Card>
      <Card title="Não recebeu?">
        <ResendForm defaultEmail={email} />
      </Card>
    </AuthLayout>
  );
}

/**
 * Confirmação de e-mail. Com `?token=` (o link do e-mail), mostra o botão que confirma a conta;
 * sem ele, é a tela de espera mostrada logo depois do cadastro.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");

  return token ? <ConfirmingByLink token={token} /> : <WaitingForConfirmation />;
}
