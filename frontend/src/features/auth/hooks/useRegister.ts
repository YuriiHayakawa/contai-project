import { useMutation } from "@tanstack/react-query";

import { register } from "../services/authService";

/** Cria a conta. A resposta é a mesma para um e-mail novo e para um já cadastrado. */
export function useRegister() {
  return useMutation({ mutationFn: register });
}
