import { useMutation } from "@tanstack/react-query";

import { readPendingChallenge, setPendingChallenge } from "../challenge";
import { loginTwoFactor } from "../services/auth";
import { useSession } from "../SessionProvider";
import type { TwoFactorMode } from "../types";

export interface TwoFactorInput {
  mode: TwoFactorMode;
  code: string;
}

/** Conclui a entrada com o código do app ou um de recuperação, e grava a sessão. */
export function useTwoFactorLogin() {
  const { signIn } = useSession();
  return useMutation({
    mutationFn: async ({ mode, code }: TwoFactorInput) => {
      const challenge = readPendingChallenge() ?? "";
      const response = await loginTwoFactor(
        mode === "app"
          ? { challenge_token: challenge, code }
          : { challenge_token: challenge, recovery_code: code },
      );
      setPendingChallenge(null);
      await signIn({ accessToken: response.access_token, refreshToken: response.refresh_token });
    },
  });
}
