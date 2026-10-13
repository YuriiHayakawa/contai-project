import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sessionQueryKey } from "../../auth/hooks/useAuth";
import {
  disableTwoFactor,
  enableTwoFactor,
  regenerateRecoveryCodes,
  setupTwoFactor,
} from "../services/settingsService";
import type { TwoFactorPasswordCode } from "../types";

/** Começa a configuração: gera o segredo e o QR code. Ainda não ativa. */
export function useSetupTwoFactor() {
  return useMutation({ mutationFn: () => setupTwoFactor() });
}

/** Ativa a verificação depois de confirmar o código; o perfil passa a mostrá-la ligada. */
export function useEnableTwoFactor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => enableTwoFactor(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });
}

/** Desativa a verificação; o perfil volta a mostrá-la desligada. */
export function useDisableTwoFactor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TwoFactorPasswordCode) => disableTwoFactor(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });
}

/** Gera novos códigos de recuperação, invalidando os anteriores. */
export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: (input: TwoFactorPasswordCode) => regenerateRecoveryCodes(input),
  });
}
