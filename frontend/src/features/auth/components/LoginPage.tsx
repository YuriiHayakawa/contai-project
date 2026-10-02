import { Clock } from "lucide-react";
import { Navigate, useLocation } from "react-router";

import { Card } from "../../../components/ui/Card";
import { SESSION_EXPIRED_MESSAGE } from "../../../lib/api-client";
import { returnPathFrom } from "../../../lib/paths";
import { useAuth } from "../hooks/useAuth";

/**
 * Tela de entrada. Quem já está conectado volta para a rota de origem; quem chegou aqui porque
 * a sessão expirou vê o aviso, sem tela de erro técnico. O formulário entra na T070.
 */
export function LoginPage() {
  const { status, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === "authenticated") {
    return <Navigate to={returnPathFrom(location.state)} replace />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-100 flex-col justify-center gap-6 px-4 py-8">
      <p className="font-display text-display font-extrabold text-primary">Contaí</p>
      <h1 className="font-display text-title-1 text-ink">Entrar</h1>

      {sessionExpired && (
        <p role="status" className="flex items-start gap-3 rounded-lg bg-warning-soft p-4 text-ink">
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
          {SESSION_EXPIRED_MESSAGE}
        </p>
      )}

      <Card>
        <p className="text-body text-ink-muted">
          A entrada com e-mail e senha ainda está sendo preparada.
        </p>
      </Card>
    </main>
  );
}
