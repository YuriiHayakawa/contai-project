import { useMutation } from "@tanstack/react-query";

import { setPendingChallenge } from "../challenge";
import { login } from "../services/auth";
import { useSession } from "../SessionProvider";
import type { LoginInput } from "../types";

/** O que o login resolveu: já entrou, ou falta a segunda etapa. */
export interface LoginResult {
  twoFactorRequired: boolean;
}

/**
 * Entra com e-mail e senha. Sem duas etapas, grava a sessão no aparelho. Com elas, guarda o
 * desafio em memória para a tela do código.
 */
export function useLogin() {
  const { signIn } = useSession();
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResult> => {
      const response = await login(input);
      if (response.two_factor_required && response.challenge_token) {
        setPendingChallenge(response.challenge_token);
        return { twoFactorRequired: true };
      }
      if (response.access_token && response.refresh_token) {
        await signIn({ accessToken: response.access_token, refreshToken: response.refresh_token });
      }
      return { twoFactorRequired: false };
    },
  });
}
