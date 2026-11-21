import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPersonalToken,
  listPersonalTokens,
  revokePersonalToken,
  updateDefaultAccount,
} from "../services/personal-tokens";
import type { PersonalTokenInput } from "../types";

export const personalTokensQueryKey = ["personal-tokens"] as const;

/** Os tokens ativos da Siri, do mais novo para o mais antigo. */
export function usePersonalTokens() {
  return useQuery({
    queryKey: personalTokensQueryKey,
    queryFn: ({ signal }) => listPersonalTokens(signal),
  });
}

function useRefreshTokens(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: personalTokensQueryKey });
}

export function useCreatePersonalToken() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: (input: PersonalTokenInput) => createPersonalToken(input),
    onSuccess: refresh,
  });
}

export function useUpdateDefaultAccount() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      updateDefaultAccount(id, accountId),
    onSuccess: refresh,
  });
}

export function useRevokePersonalToken() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: (id: string) => revokePersonalToken(id),
    onSuccess: refresh,
  });
}
