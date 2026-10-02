import { api, refreshAccessToken, setAccessToken } from "../../../lib/api-client";
import type { CurrentUser } from "../types";

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

/** Esquece o access token. A revogação no servidor é do `POST /auth/logout`. */
export function endSession(): void {
  setAccessToken(null);
}
