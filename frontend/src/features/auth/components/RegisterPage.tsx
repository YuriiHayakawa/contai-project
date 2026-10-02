import { useNavigate } from "react-router";

import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { paths } from "../../../lib/paths";
import type { VerifyEmailLocationState } from "../types";
import { AuthLayout } from "./AuthLayout";
import { RegisterForm } from "./RegisterForm";

/** Tela de cadastro. Depois de criar a conta, leva à tela que pede a confirmação do e-mail. */
export function RegisterPage() {
  const navigate = useNavigate();

  const goToConfirmation = (email: string): void => {
    const state: VerifyEmailLocationState = { email };
    void navigate(paths.verifyEmail, { state });
  };

  return (
    <AuthLayout
      title="Criar conta"
      footer={
        <>
          Já tem conta?{" "}
          <TextLink to={paths.login} standalone>
            Entrar
          </TextLink>
        </>
      }
    >
      <Card>
        <RegisterForm onRegistered={goToConfirmation} />
      </Card>
    </AuthLayout>
  );
}
