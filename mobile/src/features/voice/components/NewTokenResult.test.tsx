import { render, screen, userEvent } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";

import { ToastProvider } from "@/components/ui/Toast";
import { getConfig } from "@/lib/config";

import { NewTokenResult } from "./NewTokenResult";

jest.mock("expo-clipboard", () => {
  let content = "";
  return {
    setStringAsync: jest.fn(async (text: string) => {
      content = text;
      return true;
    }),
    getStringAsync: jest.fn(async () => content),
  };
});
jest.mock("expo-linking", () => ({ openURL: jest.fn(async () => true) }));
jest.mock("@/lib/config", () => ({ getConfig: jest.fn() }));

const TOKEN = "ctp_8e9b3a1c-0000-4000-8000-000000000000.segredo-do-token";
const config = jest.mocked(getConfig);

async function renderResult() {
  const result = await render(
    <ToastProvider>
      <NewTokenResult token={TOKEN} onDone={jest.fn()} />
    </ToastProvider>,
  );
  return { ...result, user: userEvent.setup() };
}

beforeEach(async () => {
  await Clipboard.setStringAsync("");
  jest.mocked(Clipboard.setStringAsync).mockClear();
  config.mockReturnValue({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null });
});

describe("token recém-criado", () => {
  it("mostra o token uma vez, avisa que não volta a aparecer e copia", async () => {
    const { user } = await renderResult();

    expect(screen.getByText(TOKEN)).toBeOnTheScreen();
    expect(screen.getByText(/só aparece agora/)).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Copiar o token" }));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByText("Token copiado.")).toBeOnTheScreen();
  });

  it("ao sair da tela, limpa a área de transferência se ainda tiver o token", async () => {
    const { user, unmount } = await renderResult();
    await user.press(screen.getByRole("button", { name: "Copiar o token" }));

    await unmount();

    await new Promise((resolve) => setImmediate(resolve));
    expect(await Clipboard.getStringAsync()).toBe("");
  });

  it("não apaga o que a pessoa copiou depois", async () => {
    const { user, unmount } = await renderResult();
    await user.press(screen.getByRole("button", { name: "Copiar o token" }));
    await Clipboard.setStringAsync("outra coisa");

    await unmount();

    await new Promise((resolve) => setImmediate(resolve));
    expect(await Clipboard.getStringAsync()).toBe("outra coisa");
  });

  it("sem o link do atalho pronto, mostra só o passo a passo", async () => {
    await renderResult();

    expect(screen.queryByRole("button", { name: "Instalar o atalho" })).not.toBeOnTheScreen();
    expect(screen.getByText(/Obter conteúdo de URL/)).toBeOnTheScreen();
  });

  it("com o link do atalho pronto, oferece instalar antes do passo a passo", async () => {
    config.mockReturnValue({
      apiUrl: "https://contai-project.vercel.app",
      shortcutUrl: "https://www.icloud.com/shortcuts/abc",
    });
    const { user } = await renderResult();

    await user.press(screen.getByRole("button", { name: "Instalar o atalho" }));

    expect(Linking.openURL).toHaveBeenCalledWith("https://www.icloud.com/shortcuts/abc");
  });
});
