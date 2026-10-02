import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextLink } from "../../../components/ui/TextLink";
import { SESSION_EXPIRED_MESSAGE } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useAuth } from "../hooks/useAuth";
import { AuthLayout } from "./AuthLayout";
import { LoginForm } from "./LoginForm";

/**
 * Tela de entrada. Quem chegou aqui porque a sessão expirou vê o aviso, sem tela de erro
 * técnico; depois de entrar, a rota leva a pessoa de volta para onde ela estava.
 */
export function LoginPage() {
  const { sessionExpired } = useAuth();

  return (
    <AuthLayout
      title="Entrar"
      footer={
        <>
          Ainda não tem conta?{" "}
          <TextLink to={paths.register} standalone>
            Criar conta
          </TextLink>
        </>
      }
    >
      {sessionExpired && <Notice kind="warning">{SESSION_EXPIRED_MESSAGE}</Notice>}
      <Card>
        <LoginForm />
      </Card>
    </AuthLayout>
  );
}
