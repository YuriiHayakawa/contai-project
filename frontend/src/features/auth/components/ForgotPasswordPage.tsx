import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useForgotPassword } from "../hooks/useForgotPassword";
import { emailOnlySchema, type EmailOnlyFormValues } from "../schemas";
import { AuthLayout } from "./AuthLayout";

/** Pedido do link para criar uma nova senha. A resposta é a mesma exista ou não a conta. */
export function ForgotPasswordPage() {
  const request = useForgotPassword();
  const {
    register: field,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyFormValues>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  const submit = handleSubmit((values) => request.mutate(values.email));

  const footer = (
    <>
      Lembrou a senha?{" "}
      <TextLink to={paths.login} standalone>
        Entrar
      </TextLink>
    </>
  );

  if (request.isSuccess) {
    return (
      <AuthLayout title="Confira seu e-mail" footer={footer}>
        <Notice kind="success">{request.data.message}</Notice>
        <p className="text-body text-ink-muted">O link vale por 1 hora e só funciona uma vez.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Esqueci minha senha" footer={footer}>
      <Card>
        <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
          <p className="text-body text-ink-muted">
            Escreva o e-mail da sua conta. Vamos enviar um link para você criar uma nova senha.
          </p>
          {request.isError && <Notice kind="error">{errorMessage(request.error)}</Notice>}
          <TextField
            label="E-mail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            error={errors.email?.message}
            {...field("email")}
          />
          <Button type="submit" block loading={request.isPending}>
            Enviar link
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
