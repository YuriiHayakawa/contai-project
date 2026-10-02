import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useResetPassword } from "../hooks/useResetPassword";
import { resetPasswordSchema, type ResetPasswordFormValues } from "../schemas";
import { AuthLayout } from "./AuthLayout";

interface ResetFormProps {
  token: string;
}

const askForNewLink = (
  <TextLink to={paths.forgotPassword} standalone>
    Pedir um novo link
  </TextLink>
);

function ResetForm({ token }: ResetFormProps) {
  const navigate = useNavigate();
  const reset = useResetPassword();
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "" },
  });

  // A senha recusada pelo servidor (por exemplo, uma senha comum) aparece junto do campo.
  const passwordRefused = "new_password" in fieldErrors(reset.error);

  const submit = handleSubmit((values) => {
    reset.mutate(
      { token, new_password: values.newPassword },
      {
        onError: (error) => {
          const message = fieldErrors(error).new_password;
          if (message) setError("newPassword", { message }, { shouldFocus: true });
        },
      },
    );
  });

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Senha alterada">
        <Notice kind="success">
          Sua nova senha já está valendo. Por segurança, é preciso entrar de novo em todos os seus
          aparelhos.
        </Notice>
        <Button block onClick={() => void navigate(paths.login)}>
          Entrar
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar nova senha" footer={askForNewLink}>
      <Card>
        <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
          {reset.isError && !passwordRefused && (
            <Notice kind="error">{errorMessage(reset.error)}</Notice>
          )}
          <TextField
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            help="Pelo menos 8 caracteres. Uma frase que só você conheça funciona bem."
            error={errors.newPassword?.message}
            {...field("newPassword")}
          />
          <Button type="submit" block loading={reset.isPending}>
            Salvar nova senha
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}

/** Chegada pelo link de redefinição de senha (`?token=`). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");

  if (!token) {
    return (
      <AuthLayout title="Link incompleto" footer={askForNewLink}>
        <Notice kind="error">
          Este endereço não tem o código do link. Abra de novo o link que está no e-mail ou peça um
          novo.
        </Notice>
      </AuthLayout>
    );
  }

  return <ResetForm token={token} />;
}
