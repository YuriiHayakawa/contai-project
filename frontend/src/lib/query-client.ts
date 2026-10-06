import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "./api-client";

const MAX_RETRIES = 2;

/** Erros 4xx são respostas definitivas da API; só falha de rede e 5xx valem nova tentativa. */
function shouldRetry(failureCount: number, error: unknown): boolean {
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
