import { useMutation } from "@tanstack/react-query";

import { login } from "../services/authService";
import type { LoginInput } from "../types";
import { useAuth } from "./useAuth";

/** O que o login resolveu: ou já entrou, ou falta a segunda etapa (com o desafio). */
export interface LoginOutcome {
  challengeToken: string | null;
}

/**
 * Entra com e-mail e senha. Sem verificação em duas etapas, já começa a sessão neste aparelho.
 * Com ela, não dá acesso: devolve o desafio para a tela seguinte pedir o código.
 */
export function useLogin() {
  const { signIn } = useAuth();

  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginOutcome> => {
      const response = await login(input);
      if (response.two_factor_required && response.challenge_token) {
        return { challengeToken: response.challenge_token };
      }
      if (response.access_token) {
        await signIn(response.access_token);
      }
      return { challengeToken: null };
    },
  });
}
