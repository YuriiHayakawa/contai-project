import { api } from "@/lib/api-client";

import type {
  PersonalToken,
  PersonalTokenCreated,
  PersonalTokenInput,
  PersonalTokenList,
} from "../types";

export async function listPersonalTokens(signal?: AbortSignal): Promise<PersonalToken[]> {
  const { items } = await api.get<PersonalTokenList>("/personal-tokens", { signal });
  return items;
}

export function createPersonalToken(input: PersonalTokenInput): Promise<PersonalTokenCreated> {
  return api.post<PersonalTokenCreated>("/personal-tokens", input);
}

export function updateDefaultAccount(id: string, accountId: string): Promise<PersonalToken> {
  return api.patch<PersonalToken>(`/personal-tokens/${id}`, { default_account_id: accountId });
}

/** Revoga o token: a Siri para de lançar com ele já na frase seguinte. */
export function revokePersonalToken(id: string): Promise<void> {
  return api.delete<void>(`/personal-tokens/${id}`);
}
