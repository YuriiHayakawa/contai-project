import { useMutation } from "@tanstack/react-query";

import { login } from "../services/authService";
import type { LoginInput } from "../types";
import { useAuth } from "./useAuth";

/** Entra com e-mail e senha e começa a sessão neste aparelho. */
export function useLogin() {
  const { signIn } = useAuth();

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { access_token: accessToken } = await login(input);
      await signIn(accessToken);
    },
  });
}
