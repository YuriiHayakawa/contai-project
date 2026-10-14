import { Navigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextLink } from "../../../components/ui/TextLink";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useAuth } from "../../auth/hooks/useAuth";
import { useLogout } from "../../auth/hooks/useLogout";
import { AuthLayout } from "../../auth/components/AuthLayout";
import { useCancelDeletion } from "../hooks/useAccount";

function deletionDateLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Tela única de quem entrou com a conta em exclusão (FR-017). Mostra a data da exclusão
 * definitiva e deixa cancelar ali mesmo; o resto do app fica fora do alcance até cancelar.
 */
export function PendingDeletionPage() {
  const { user } = useAuth();
  const cancel = useCancelDeletion();
  const logout = useLogout();
  const toast = useToast();

  // A conta voltou a ser ativa (acabou de cancelar, ou nunca esteve em exclusão): sai daqui.
  if (user && user.status !== "pending_deletion") {
    return <Navigate to={paths.home} replace />;
  }

  const cancelDeletion = (): void => {
    cancel.mutate(undefined, {
      onSuccess: () => toast.success("Pronto! Sua conta foi reativada."),
    });
  };

  return (
    <AuthLayout
      title="Sua conta está para ser excluída"
      footer={
        <TextLink to={paths.login} standalone onClick={() => logout.mutate()}>
          Sair
        </TextLink>
      }
    >
      <Card>
        <div className="grid gap-4">
          <Notice kind="warning">
            {user?.deletion_scheduled_at ? (
              <>
                Sua conta está desativada e será apagada de vez em{" "}
                <strong>{deletionDateLabel(user.deletion_scheduled_at)}</strong>. Depois dessa data,
                seus dados não poderão mais ser recuperados.
              </>
            ) : (
              "Sua conta está desativada e será apagada de vez em breve."
            )}
          </Notice>
          <p className="text-body text-ink">
            Mudou de ideia? Cancele a exclusão agora e sua conta volta a funcionar com tudo no
            lugar.
          </p>
          {cancel.isError && <Notice kind="error">{errorMessage(cancel.error)}</Notice>}
          <Button block loading={cancel.isPending} onClick={cancelDeletion}>
            Cancelar a exclusão e voltar a usar
          </Button>
        </div>
      </Card>
    </AuthLayout>
  );
}
