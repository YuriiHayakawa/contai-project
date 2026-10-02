import { useEffect } from "react";
import { useRouteError } from "react-router";

import { EmptyState } from "../ui/EmptyState";

/**
 * Limite de erro do app, usado como `errorElement` da rota raiz. Um erro inesperado ao desenhar
 * uma tela cai aqui, com uma mensagem que diz o que fazer; o detalhe técnico vai só para o
 * console.
 */
export function ErrorPage() {
  const error = useRouteError();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        kind="error"
        title="Algo deu errado"
        description="Recarregue a página. Se continuar assim, tente de novo em alguns minutos."
        actionLabel="Recarregar a página"
        onAction={() => window.location.reload()}
      />
    </main>
  );
}
