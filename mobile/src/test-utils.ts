// Ajudas dos testes do app.
import { QueryClient } from "@tanstack/react-query";

/**
 * Cache de consultas para testes: sem novas tentativas e sem os timers de limpeza de 5 minutos,
 * que deixariam o Jest esperando depois do último teste.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}
