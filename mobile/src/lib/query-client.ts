// Cache de consultas do app: só em memória, e some ao fechar o app (modo offline está fora do
// escopo). Voltar ao app conta como foco: o TanStack Query refaz as consultas vencidas, e o
// painel mostra na hora o que a Siri lançou (SC-004).
import { QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

import { isApiError } from "./api-client";

const MAX_RETRIES = 2;

/** 401, 403, 422 e os outros 4xx são respostas definitivas da API: não vale tentar de novo. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
}

/** Liga o foco do TanStack Query ao app voltar para a frente. Chamado uma vez, na raiz. */
export function bindAppFocus(): void {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      handleFocus(status === "active");
    });
    return () => subscription.remove();
  });
}
