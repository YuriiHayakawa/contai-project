import { useQuery } from "@tanstack/react-query";

import { verifyEmail } from "../services/authService";

/**
 * Confirma o e-mail com o token do link, uma única vez. É uma consulta, e não uma mutação,
 * para o TanStack Query garantir um só pedido por token: o link é de uso único, e um segundo
 * pedido (por exemplo, da montagem dupla do modo estrito) receberia "link inválido".
 */
export function useVerifyEmail(token: string | null) {
  return useQuery({
    queryKey: ["auth", "verify-email", token],
    queryFn: async () => {
      await verifyEmail(token ?? "");
      return true;
    },
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
