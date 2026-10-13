import { useSearchParams } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useConfirmTwoFactorReset } from "../hooks/useTwoFactorReset";
import { AuthLayout } from "./AuthLayout";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Link do e-mail que abre a contagem de 72 horas para desativar a verificação em duas etapas.
 * A confirmação é um clique deliberado: abrir o endereço, sozinho, não desativa nada.
 */
export function TwoFactorResetConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const confirm = useConfirmTwoFactorReset();

  return (
    <AuthLayout
      title="Desativar a verificação em duas etapas"
      footer={
        <TextLink to={paths.login} standalone>
          Voltar para a entrada
        </TextLink>
      }
    >
      {!token ? (
        <Notice kind="warning">
          Este link está incompleto. Abra o link do e-mail mais recente, inteiro.
        </Notice>
      ) : confirm.isSuccess ? (
        <Notice kind="success">
          Tudo certo. A verificação em duas etapas será desativada em{" "}
          <strong>{formatDate(confirm.data.effective_at)}</strong>. Até lá, a entrada continua
          pedindo o código. Enviamos um e-mail com um link para cancelar, caso tenha sido engano.
        </Notice>
      ) : (
        <Card>
          <div className="grid gap-4">
            <p className="text-body text-ink">
              Ao confirmar, a verificação em duas etapas desta conta será desativada daqui a 72
              horas. Nesse período você pode cancelar pelo e-mail que enviaremos, ou entrando com um
              código do aplicativo. Quando a desativação valer, todas as sessões serão encerradas.
            </p>
            {confirm.isError && <Notice kind="error">{errorMessage(confirm.error)}</Notice>}
            <Button block loading={confirm.isPending} onClick={() => confirm.mutate(token)}>
              Confirmar a desativação
            </Button>
          </div>
        </Card>
      )}
    </AuthLayout>
  );
}
