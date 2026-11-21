import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, userEvent } from "@testing-library/react-native";
import * as Linking from "expo-linking";

import { createTestQueryClient } from "@/test-utils";
import { ToastProvider } from "@/components/ui/Toast";
import * as authService from "@/features/auth/services/auth";
import { SessionProvider } from "@/features/auth/SessionProvider";
import { readRefreshToken, saveRefreshToken, setAccessToken } from "@/lib/session";

import { MoreScreen } from "./MoreScreen";

jest.mock("@/features/auth/services/auth");
jest.mock("expo-linking", () => ({ openURL: jest.fn(async () => true) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/config", () => ({
  getConfig: () => ({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null }),
}));

const logout = jest.mocked(authService.logout);

async function renderScreen() {
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SessionProvider>
        <ToastProvider>
          <MoreScreen />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe("Mais", () => {
  it("sair pede confirmação, encerra a sessão na API e apaga a do aparelho", async () => {
    setAccessToken("access");
    await saveRefreshToken("sessao.1");
    logout.mockResolvedValue(undefined);
    const user = await renderScreen();

    await user.press(screen.getByRole("button", { name: "Sair da conta" }));
    expect(logout).not.toHaveBeenCalled();
    await user.press(screen.getByRole("button", { name: "Sair" }));

    expect(logout).toHaveBeenCalled();
    expect(await readRefreshToken()).toBeNull();
  });

  it("sem rede, sai do aparelho mesmo assim", async () => {
    await saveRefreshToken("sessao.1");
    logout.mockRejectedValue(new Error("sem rede"));
    const user = await renderScreen();

    await user.press(screen.getByRole("button", { name: "Sair da conta" }));
    await user.press(screen.getByRole("button", { name: "Sair" }));

    expect(await readRefreshToken()).toBeNull();
  });

  it("as ações de conta abrem as configurações do site", async () => {
    const user = await renderScreen();

    const exportButton = screen.getByRole("button", { name: "Exportar meus dados" });
    expect(exportButton.props.accessibilityHint).toBe("Abre o site do Contaí no navegador.");
    await user.press(exportButton);

    expect(Linking.openURL).toHaveBeenCalledWith("https://contai-project.vercel.app/configuracoes");
  });
});
