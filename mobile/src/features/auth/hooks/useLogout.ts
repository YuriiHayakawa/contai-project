import { useMutation } from "@tanstack/react-query";

import { logout } from "../services/auth";
import { useSession } from "../SessionProvider";

/**
 * Sai da conta neste aparelho: encerra a sessão na API e apaga o Keychain e o cache de
 * consultas. Sem rede, a saída local acontece mesmo assim; a sessão na API vence sozinha.
 */
export function useLogout() {
  const { signOut } = useSession();
  return useMutation({
    mutationFn: async () => {
      await logout().catch(() => undefined);
      await signOut("logout");
    },
  });
}
