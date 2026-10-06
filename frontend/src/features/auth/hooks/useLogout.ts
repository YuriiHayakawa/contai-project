import { useMutation } from "@tanstack/react-query";

import { logout } from "../services/authService";
import { useAuth } from "./useAuth";

/**
 * Sai da conta neste aparelho. Mesmo que o servidor não responda, a sessão local é encerrada:
 * quem pediu para sair não pode continuar vendo as telas internas.
 */
export function useLogout() {
  const { signOut } = useAuth();

  return useMutation({
    mutationFn: logout,
    onSettled: () => signOut(),
  });
}
