// Chamadas HTTP de acesso à conta. Só os hooks desta feature chamam este módulo.
import { api, refreshAccessToken, setAccessToken } from "../../../lib/api-client";
import type {
  CurrentUser,
  LoginInput,
  MessageResponse,
  RegisterInput,
  ResetPasswordInput,
  TokenResponse,
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

export function login(input: LoginInput): Promise<TokenResponse> {
  return api.post<TokenResponse>("/auth/login", input);
}

/** Encerra a sessão deste aparelho no servidor e apaga o cookie de refresh. */
export function logout(): Promise<void> {
  return api.post("/auth/logout");
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
