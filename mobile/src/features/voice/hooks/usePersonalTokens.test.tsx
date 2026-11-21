import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { ToastProvider } from "@/components/ui/Toast";
import { createTestQueryClient } from "@/test-utils";

import * as accountsService from "../../accounts/services/accounts";
import { accounts } from "../../transactions/fixtures";
import { SiriScreen } from "../components/SiriScreen";
import * as service from "../services/personal-tokens";
import type { PersonalToken } from "../types";

jest.mock("../services/personal-tokens");
jest.mock("../../accounts/services/accounts");
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const listTokens = jest.mocked(service.listPersonalTokens);
const revoke = jest.mocked(service.revokePersonalToken);
const update = jest.mocked(service.updateDefaultAccount);

function token(id: string, extra: Partial<PersonalToken> = {}): PersonalToken {
  return {
    id,
    name: "iPhone da Ana",
    default_account: { id: "acc-nubank", name: "Nubank" },
    needs_default_account: false,
    created_at: "2026-11-21T12:00:00Z",
    last_used_at: null,
    ...extra,
  };
}

async function renderScreen() {
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <SiriScreen />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  [listTokens, revoke, update].forEach((mock) => mock.mockReset());
  jest.mocked(accountsService.listAccounts).mockResolvedValue(accounts);
});

describe("tela da Siri", () => {
  it("lista os tokens com a conta padrão e avisa sobre a troca de senha", async () => {
    listTokens.mockResolvedValue([token("t1")]);

    await renderScreen();

    expect(await screen.findByText("iPhone da Ana")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Conta padrão: Nubank" })).toBeOnTheScreen();
    expect(screen.getByText(/Trocar a senha desconecta a Siri/)).toBeOnTheScreen();
  });

  it("avisa quando falta a conta padrão", async () => {
    listTokens.mockResolvedValue([
      token("t1", { default_account: null, needs_default_account: true }),
    ]);

    await renderScreen();

    expect(await screen.findByText(/Escolha uma conta padrão/)).toBeOnTheScreen();
  });

  it("troca a conta padrão", async () => {
    listTokens.mockResolvedValue([token("t1")]);
    update.mockResolvedValue(token("t1"));
    const user = await renderScreen();

    await user.press(await screen.findByRole("button", { name: "Conta padrão: Nubank" }));
    await user.press(screen.getByRole("radio", { name: "Inter crédito" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("t1", "acc-inter"));
  });

  it("revogar pede confirmação", async () => {
    listTokens.mockResolvedValue([token("t1")]);
    revoke.mockResolvedValue(undefined);
    const user = await renderScreen();

    await user.press(await screen.findByRole("button", { name: "Desconectar iPhone da Ana" }));
    expect(revoke).not.toHaveBeenCalled();
    expect(
      screen.getByRole("header", { name: "Desconectar a Siri deste token?" }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Desconectar" }));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("t1"));
  });

  it("sem tokens, convida a conectar", async () => {
    listTokens.mockResolvedValue([]);

    await renderScreen();

    expect(await screen.findByRole("button", { name: "Conectar a Siri" })).toBeOnTheScreen();
  });
});
