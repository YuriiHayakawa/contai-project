// Chamadas HTTP da conta: perfil, senha, sessões e verificação em duas etapas. Só os hooks
// desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { CurrentUser, RecoveryCodes, SessionInfo, TwoFactorSetup } from "../../auth/types";
import type { ChangePasswordInput, TwoFactorPasswordCode, UpdateProfileInput } from "../types";

export function updateProfile(input: UpdateProfileInput): Promise<CurrentUser> {
  return api.patch<CurrentUser>("/users/me", input);
}

export function changePassword(input: ChangePasswordInput): Promise<void> {
  return api.post("/users/me/password", input);
}

export function listSessions(): Promise<SessionInfo[]> {
  return api.get<SessionInfo[]>("/users/me/sessions");
}

export function endSession(id: string): Promise<void> {
  return api.delete(`/users/me/sessions/${id}`);
}

export function endOtherSessions(): Promise<void> {
  return api.delete("/users/me/sessions");
}

// ---------- verificação em duas etapas

export function setupTwoFactor(): Promise<TwoFactorSetup> {
  return api.post<TwoFactorSetup>("/users/me/2fa/setup");
}

export function enableTwoFactor(code: string): Promise<RecoveryCodes> {
  return api.post<RecoveryCodes>("/users/me/2fa/enable", { code });
}

export function disableTwoFactor(input: TwoFactorPasswordCode): Promise<void> {
  return api.post("/users/me/2fa/disable", input);
}

export function regenerateRecoveryCodes(input: TwoFactorPasswordCode): Promise<RecoveryCodes> {
  return api.post<RecoveryCodes>("/users/me/2fa/recovery-codes", input);
}
