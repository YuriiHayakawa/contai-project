import { useMutation } from "@tanstack/react-query";

import { resendVerification } from "../services/authService";

/** Pede um novo link de confirmação. A resposta não revela se o e-mail tem conta. */
export function useResendVerification() {
  return useMutation({ mutationFn: resendVerification });
}
