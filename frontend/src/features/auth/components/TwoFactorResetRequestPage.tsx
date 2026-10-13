import { useLocation } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Notice } from "../../../components/ui/Notice";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useRequestTwoFactorReset } from "../hooks/useTwoFactorReset";
import type { TwoFactorLocationState } from "../types";
import { AuthLayout } from "./AuthLayout";

/**
 * Pedido de desativação da verificação em duas etapas, para quem perdeu o celular e os códigos
 * (FR-013). Exige ter passado pela senha (o desafio vem da etapa anterior). Por segurança, a
 * desativação só vale 72 horas depois, com aviso por e-mail e chance de cancelar.
 */
export function TwoFactorResetRequestPage() {
  const location = useLocation();
  const request = useRequestTwoFactorReset();
  const state = location.state as TwoFactorLocationState | null;
  const challengeToken = state?.challengeToken;

  return (
    <AuthLayout
      title="Recuperar o acesso"
      footer={
        <TextLink to={paths.login} standalone>
          Voltar para a entrada
        </TextLink>
      }
    >
      {!challengeToken ? (
        <Notice kind="warning">
          Para pedir a desativação, comece entrando com seu e-mail e senha.
        </Notice>
      ) : request.isSuccess ? (
        <Notice kind="success">
          Se a verificação em duas etapas estiver ativa nesta conta, enviamos para o seu e-mail um
          link para desativá-la. Abra o link e confirme: a desativação passa a valer 72 horas
          depois, e avisaremos você por e-mail antes disso. Se foi engano, é só não abrir o link.
        </Notice>
      ) : (
        <Card>
          <div className="grid gap-4">
            <p className="text-body text-ink">
              Perdeu o aplicativo autenticador e também os códigos de recuperação? Dá para
              desativar a verificação em duas etapas por e-mail. Veja como funciona:
            </p>
            <ul className="grid list-disc gap-2 pl-5 text-body text-ink-muted">
              <li>Enviamos um link para o e-mail da conta.</li>
              <li>Ao abrir o link, começa uma espera de 72 horas, por segurança.</li>
              <li>Durante a espera, avisamos você por e-mail e dá para cancelar a qualquer hora.</li>
              <li>Entrar com um código do aplicativo também cancela o pedido.</li>
            </ul>
            {request.isError && <Notice kind="error">{errorMessage(request.error)}</Notice>}
            <Button block loading={request.isPending} onClick={() => request.mutate(challengeToken)}>
              Enviar o link por e-mail
            </Button>
          </div>
        </Card>
      )}
    </AuthLayout>
  );
}
