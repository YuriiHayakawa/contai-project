import { useSearchParams } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useCancelTwoFactorReset } from "../hooks/useTwoFactorReset";
import { AuthLayout } from "./AuthLayout";

/** Link do e-mail que cancela o pedido de desativação da verificação em duas etapas. */
export function TwoFactorResetCancelPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const cancel = useCancelTwoFactorReset();

  return (
    <AuthLayout
      title="Cancelar a desativação"
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
      ) : cancel.isSuccess ? (
        <Notice kind="success">
          Pronto, cancelamos o pedido. A verificação em duas etapas continua ativa, e a entrada
          segue pedindo o código.
        </Notice>
      ) : (
        <Card>
          <div className="grid gap-4">
            <p className="text-body text-ink">
              Alguém pediu para desativar a verificação em duas etapas desta conta. Se não foi você,
              ou se mudou de ideia, cancele o pedido agora.
            </p>
            {cancel.isError && <Notice kind="error">{errorMessage(cancel.error)}</Notice>}
            <Button block loading={cancel.isPending} onClick={() => cancel.mutate(token)}>
              Cancelar a desativação
            </Button>
          </div>
        </Card>
      )}
    </AuthLayout>
  );
}
