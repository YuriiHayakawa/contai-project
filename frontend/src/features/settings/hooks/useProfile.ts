import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { CurrentUser } from "../../auth/types";
import { sessionQueryKey } from "../../auth/hooks/useAuth";
import { changePassword, updateProfile } from "../services/settingsService";
import type { ChangePasswordInput, UpdateProfileInput } from "../types";

/** Altera o nome. O perfil atualizado entra no cache da sessão, para a barra lateral acompanhar. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: (user: CurrentUser) => queryClient.setQueryData(sessionQueryKey, user),
  });
}

/** Troca a senha. O servidor encerra as outras sessões; esta continua valendo. */
export function useChangePassword() {
  return useMutation({ mutationFn: (input: ChangePasswordInput) => changePassword(input) });
}
