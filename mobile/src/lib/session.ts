// Sessão do app (research, seção 5; ADR 0012). O refresh token fica no Keychain, que só abre
// depois do primeiro desbloqueio do aparelho e não vai para backups. O access token vive só em
// memória: some ao fechar o app, e a abertura renova a sessão com o refresh token.
import * as SecureStore from "expo-secure-store";

export const REFRESH_TOKEN_KEY = "contai.refresh_token";

const keychainOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

/** Guarda o access token em memória, ou o apaga (`null`). Nunca vai para o Keychain. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, keychainOptions);
}

export function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, keychainOptions);
}

/** Apaga a sessão deste aparelho: o access token da memória e o refresh token do Keychain. */
export async function clearSession(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, keychainOptions);
}
