import { useEffect } from "react";
import { useRouteError } from "react-router";

import { EmptyState } from "../ui/EmptyState";

export interface ErrorPageProps {
  /** O erro capturado; vai só para o console, nunca para a tela. */
  error: unknown;
}

/**
 * Tela do limite de erro do app. Um erro inesperado ao desenhar cai aqui, com uma mensagem que
 * diz o que fazer. É a mesma tela nos dois limites: o da rota raiz (`RouteErrorPage`) e o que
 * envolve os provedores em App.tsx.
 */
export function ErrorPage({ error }: ErrorPageProps) {
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

/** `errorElement` da rota raiz: erros ao desenhar uma rota. */
export function RouteErrorPage() {
  return <ErrorPage error={useRouteError()} />;
}
