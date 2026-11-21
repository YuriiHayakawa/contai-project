// Tipos do login do app (contracts/rest-api.md, "Login do app"). A entrada é a mesma do site; a
// resposta traz também o refresh token, que o app guarda no Keychain.
export type { LoginInput, TwoFactorLoginInput } from "@web/features/auth/types";

/** Resposta de `POST /auth/mobile/login`: as credenciais, ou o desafio da segunda etapa. */
export interface MobileLoginResponse {
  access_token: string | null;
  refresh_token: string | null;
  token_type: "bearer" | null;
  two_factor_required: boolean;
  challenge_token: string | null;
}

/** Resposta da segunda etapa e da renovação do app. */
export interface MobileTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
}

/** Segunda etapa: o código do app autenticador ou um código de recuperação. */
export type TwoFactorMode = "app" | "recovery";
