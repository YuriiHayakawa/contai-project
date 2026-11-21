// Chamadas de autenticação do app (contracts/rest-api.md, "Login do app"). A renovação mora no
// cliente HTTP, que a dispara sozinho num 401; o `refresh` daqui é a mesma função.
import { api, refreshAccessToken } from "@/lib/api-client";

import type {
  LoginInput,
  MobileLoginResponse,
  MobileTokenResponse,
  TwoFactorLoginInput,
} from "../types";

export function login(input: LoginInput): Promise<MobileLoginResponse> {
  return api.post<MobileLoginResponse>("/auth/mobile/login", input);
}

export function loginTwoFactor(input: TwoFactorLoginInput): Promise<MobileTokenResponse> {
  return api.post<MobileTokenResponse>("/auth/mobile/login/2fa", input);
}

/** Encerra a sessão deste aparelho na API, pelo `sid` do access token. */
export function logout(): Promise<void> {
  return api.post<void>("/auth/logout");
}

export const refresh = refreshAccessToken;
