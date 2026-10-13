import { useMutation } from "@tanstack/react-query";

import {
  cancelTwoFactorReset,
  confirmTwoFactorReset,
  requestTwoFactorReset,
} from "../services/authService";

/** Pede, por e-mail, a desativação da verificação em duas etapas (exige o desafio da senha). */
export function useRequestTwoFactorReset() {
  return useMutation({
    mutationFn: (challengeToken: string) => requestTwoFactorReset(challengeToken),
  });
}

/** Abre a contagem de 72 horas pelo link do e-mail; devolve quando a desativação vale. */
export function useConfirmTwoFactorReset() {
  return useMutation({ mutationFn: (token: string) => confirmTwoFactorReset(token) });
}

/** Cancela o pedido de desativação pelo link do e-mail. */
export function useCancelTwoFactorReset() {
  return useMutation({ mutationFn: (token: string) => cancelTwoFactorReset(token) });
}
