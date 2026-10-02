import { useMutation } from "@tanstack/react-query";

import { resetPassword } from "../services/authService";
import { useAuth } from "./useAuth";

/**
 * Cria a nova senha com o token do link. O servidor encerra todas as sessões da conta; a deste
 * aparelho, se houver, é esquecida aqui, para a pessoa entrar de novo com a senha nova.
 */
export function useResetPassword() {
  const { signOut } = useAuth();

  return useMutation({
    mutationFn: resetPassword,
    onSuccess: () => signOut(),
  });
}
