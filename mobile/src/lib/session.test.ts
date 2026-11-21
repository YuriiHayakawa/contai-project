import * as SecureStore from "expo-secure-store";

import {
  REFRESH_TOKEN_KEY,
  clearSession,
  getAccessToken,
  readRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from "./session";

const keychainOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

afterEach(() => {
  setAccessToken(null);
});

describe("sessão do app", () => {
  it("grava o refresh token no Keychain, fora dos backups", async () => {
    await saveRefreshToken("sessao.segredo");

    expect(REFRESH_TOKEN_KEY).toBe("contai.refresh_token");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "contai.refresh_token",
      "sessao.segredo",
      keychainOptions,
    );
  });

  it("lê o refresh token na abertura do app", async () => {
    expect(await readRefreshToken()).toBeNull();

    await saveRefreshToken("sessao.segredo");

    expect(await readRefreshToken()).toBe("sessao.segredo");
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("contai.refresh_token", keychainOptions);
  });

  it("apaga o refresh token e o access token ao sair", async () => {
    await saveRefreshToken("sessao.segredo");
    setAccessToken("access");

    await clearSession();

    expect(await readRefreshToken()).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "contai.refresh_token",
      keychainOptions,
    );
  });

  it("guarda o access token só em memória", async () => {
    setAccessToken("access");

    expect(getAccessToken()).toBe("access");
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      expect.anything(),
      "access",
      expect.anything(),
    );
  });
});
