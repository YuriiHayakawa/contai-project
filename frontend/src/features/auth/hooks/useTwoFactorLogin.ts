import { useMutation } from "@tanstack/react-query";

import { loginTwoFactor } from "../services/authService";
import type { TwoFactorLoginInput } from "../types";
import { useAuth } from "./useAuth";

/** Conclui a entrada com o código da segunda etapa e começa a sessão neste aparelho. */
export function useTwoFactorLogin() {
  const { signIn } = useAuth();

  return useMutation({
    mutationFn: async (input: TwoFactorLoginInput) => {
      const { access_token: accessToken } = await loginTwoFactor(input);
      await signIn(accessToken);
    },
  });
}
