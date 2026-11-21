// Ambiente dos testes do app: o Keychain (expo-secure-store) é um mapa em memória, e o `fetch`
// é um mock que cada teste programa. Nenhum teste fala com a rede.

import { notifyManager } from "@tanstack/react-query";

// O TanStack Query avisa as telas num `setTimeout`, fora do `act` do teste. Nos testes, o aviso
// sai na hora, dentro do `act` que causou a mudança.
notifyManager.setScheduler((callback) => callback());

// O prefixo `mock` é o que o Jest exige para a fábrica do `jest.mock` poder usar a variável.
const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

// Sem o aparelho, as áreas seguras são zero.
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

beforeEach(() => {
  mockSecureStore.clear();
  globalThis.fetch = jest.fn(() => Promise.reject(new Error("fetch não programado no teste")));
});
