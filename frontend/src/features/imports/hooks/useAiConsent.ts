import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sessionQueryKey, useAuth } from "../../auth/hooks/useAuth";
import type { CurrentUser } from "../../auth/types";
import { acceptAiDocuments } from "../services/importsService";

/**
 * O aceite do aviso que antecede o primeiro envio de PDF ou imagem (FR-044). `accepted` vem do
 * perfil do usuário; `accept` registra o aceite no servidor e atualiza o perfil em memória,
 * para o aviso não aparecer de novo.
 */
export function useAiConsent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const accept = useMutation({
    mutationFn: acceptAiDocuments,
    onSuccess: () => {
      queryClient.setQueryData<CurrentUser | null>(
        sessionQueryKey,
        (current) => current && { ...current, ai_documents_consent: true },
      );
    },
  });

  return { accepted: user?.ai_documents_consent ?? false, accept };
}
