import { useMutation } from "@tanstack/react-query";

import { forgotPassword } from "../services/authService";

/** Pede o link para criar uma nova senha. A resposta não revela se o e-mail tem conta. */
export function useForgotPassword() {
  return useMutation({ mutationFn: forgotPassword });
}
