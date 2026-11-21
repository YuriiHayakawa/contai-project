// O guard único das rotas do app (T029). Fica fora de `mobile/app/`, onde todo arquivo vira
// rota, e monta as rotas com as telas de verdade: o layout de `(app)`, o de `(auth)` e a entrada.
import { QueryClientProvider } from "@tanstack/react-query";
import { renderRouter, screen } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { createTestQueryClient } from "@/test-utils";
import { ToastProvider } from "@/components/ui/Toast";
import type { SessionStatus, SignOutReason } from "@/features/auth/SessionProvider";

import AppLayout from "../../../app/(app)/_layout";
import AuthLayout from "../../../app/(auth)/_layout";
import EntrarScreen from "../../../app/(auth)/entrar";

jest.mock("@/lib/config", () => ({
  getConfig: () => ({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null }),
}));

const mockSession = {
  status: "signedOut" as SessionStatus,
  lastSignOutReason: null as SignOutReason | null,
  restoreError: null,
  retryRestore: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
};

jest.mock("@/features/auth/SessionProvider", () => ({
  ...jest.requireActual("@/features/auth/SessionProvider"),
  useSession: () => mockSession,
}));

function Providers({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const routes = {
  "(app)/_layout": AppLayout,
  "(app)/index": () => <Text>Painel do mês</Text>,
  "(app)/lancamentos": () => <Text>Lançamentos do mês</Text>,
  "(app)/lancamento/novo": () => <Text>Novo lançamento</Text>,
  "(app)/lancamento/[id]": () => <Text>Lançamento</Text>,
  "(auth)/_layout": AuthLayout,
  "(auth)/entrar": EntrarScreen,
};

function renderAt(initialUrl: string) {
  return renderRouter(routes, { initialUrl, wrapper: Providers });
}

beforeEach(() => {
  mockSession.status = "signedOut";
  mockSession.lastSignOutReason = null;
});

describe("guard das rotas", () => {
  it("sem sessão, qualquer rota do app leva à entrada", async () => {
    const router = await renderAt("/lancamentos");

    expect(router.getPathname()).toBe("/entrar");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeOnTheScreen();
    expect(screen.queryByText("Lançamentos do mês")).not.toBeOnTheScreen();
  });

  it("com sessão, o painel abre", async () => {
    mockSession.status = "signedIn";

    const router = await renderAt("/");

    expect(router.getPathname()).toBe("/");
    expect(screen.getByText("Painel do mês")).toBeOnTheScreen();
  });

  it("com sessão, a entrada leva ao painel", async () => {
    mockSession.status = "signedIn";

    const router = await renderAt("/entrar");

    expect(router.getPathname()).toBe("/");
  });

  it("enquanto confere a sessão guardada, não mostra nem o app nem a entrada", async () => {
    mockSession.status = "loading";

    await renderAt("/");

    expect(screen.getByLabelText("Abrindo o Contaí…")).toBeOnTheScreen();
    expect(screen.queryByText("Painel do mês")).not.toBeOnTheScreen();
  });

  it("quando a sessão termina, a entrada diz o motivo", async () => {
    mockSession.lastSignOutReason = "expired";

    await renderAt("/");

    expect(
      screen.getByText("Sua sessão foi encerrada. Entre de novo para continuar."),
    ).toBeOnTheScreen();
  });

  it("depois de sair por vontade própria, a entrada não mostra aviso", async () => {
    mockSession.lastSignOutReason = "logout";

    await renderAt("/");

    expect(screen.queryByText(/sessão foi encerrada/)).not.toBeOnTheScreen();
  });
});
