import { useMutation } from "@tanstack/react-query";

import { verifyEmail } from "../services/authService";

/**
 * Confirma o e-mail com o token do link. É disparado pelo clique da pessoa, nunca ao abrir a
 * página: o link é de uso único e não pode ser gasto por quem só abriu o endereço.
 */
export function useVerifyEmail() {
  return useMutation({ mutationFn: verifyEmail });
}
