// Chamadas HTTP de acesso à conta. Só os hooks desta feature chamam este módulo.
import { api, refreshAccessToken, setAccessToken } from "../../../lib/api-client";
import type {
  CurrentUser,
  LoginInput,
  LoginResponse,
  MessageResponse,
  RegisterInput,
  ResetPasswordInput,
  TokenResponse,
  TwoFactorLoginInput,
  TwoFactorResetConfirmResponse,
} from "../types";

// ---------- cadastro e confirmação de e-mail

export function register(input: RegisterInput): Promise<MessageResponse> {
  return api.post<MessageResponse>("/auth/register", input);
}

export function verifyEmail(token: string): Promise<void> {
  return api.post("/auth/verify-email", { token });
}

export function resendVerification(email: string): Promise<MessageResponse> {
  return api.post<MessageResponse>("/auth/resend-verification", { email });
}

// ---------- entrada e saída

export function login(input: LoginInput): Promise<LoginResponse> {
  return api.post<LoginResponse>("/auth/login", input);
}

/** Conclui a entrada com um código do app autenticador ou um código de recuperação. */
export function loginTwoFactor(input: TwoFactorLoginInput): Promise<TokenResponse> {
  return api.post<TokenResponse>("/auth/login/2fa", input);
}

/** Encerra a sessão deste aparelho no servidor e apaga o cookie de refresh. */
export function logout(): Promise<void> {
  return api.post("/auth/logout");
}

// ---------- desativação da verificação em duas etapas (recuperação)

export function requestTwoFactorReset(challengeToken: string): Promise<MessageResponse> {
  return api.post<MessageResponse>("/auth/2fa/reset/request", {
    challenge_token: challengeToken,
  });
}

export function confirmTwoFactorReset(token: string): Promise<TwoFactorResetConfirmResponse> {
  return api.post<TwoFactorResetConfirmResponse>("/auth/2fa/reset/confirm", { token });
}

export function cancelTwoFactorReset(token: string): Promise<void> {
  return api.post("/auth/2fa/reset/cancel", { token });
}

// ---------- recuperação de senha

export function forgotPassword(email: string): Promise<MessageResponse> {
  return api.post<MessageResponse>("/auth/password/forgot", { email });
}

export function resetPassword(input: ResetPasswordInput): Promise<void> {
  return api.post("/auth/password/reset", input);
}

// ---------- sessão em memória

export function fetchCurrentUser(): Promise<CurrentUser> {
  return api.get<CurrentUser>("/users/me");
}

/**
 * Refresh silencioso ao carregar o app: se o cookie de refresh ainda vale, renova o access
 * token e devolve o usuário; sem sessão, devolve `null`.
 */
export async function restoreSession(): Promise<CurrentUser | null> {
  const restored = await refreshAccessToken();
  return restored ? fetchCurrentUser() : null;
}

/** Começa a sessão com o access token recebido no login e devolve o usuário. */
export async function startSession(accessToken: string): Promise<CurrentUser> {
  setAccessToken(accessToken);
  try {
    return await fetchCurrentUser();
  } catch (error) {
    setAccessToken(null);
    throw error;
  }
}

/** Esquece o access token neste aparelho. A revogação no servidor é do `logout`. */
export function endSession(): void {
  setAccessToken(null);
}
