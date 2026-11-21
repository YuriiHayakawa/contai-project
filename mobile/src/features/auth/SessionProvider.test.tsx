import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import { api, resetApiClient } from "@/lib/api-client";
import { getAccessToken, readRefreshToken, saveRefreshToken, setAccessToken } from "@/lib/session";

import { SessionProvider, useSession } from "./SessionProvider";

jest.mock("@/lib/config", () => ({
  getConfig: () => ({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null }),
}));

const fetchMock = () => globalThis.fetch as jest.MockedFunction<typeof fetch>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let session: ReturnType<typeof useSession> | null = null;

function Probe({ onSession }: { onSession: (value: ReturnType<typeof useSession>) => void }) {
  const current = useSession();
  useEffect(() => onSession(current));
  return (
    <Text>
      {current.status}:{current.lastSignOutReason ?? "-"}:{current.restoreError?.code ?? "-"}
    </Text>
  );
}

async function renderProvider() {
  const queryClient = new QueryClient();
  await render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Probe
          onSession={(value) => {
            session = value;
          }}
        />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiClient();
  setAccessToken(null);
  session = null;
});

describe("SessionProvider", () => {
  it("sem refresh token guardado, vai para a entrada sem chamar a API", async () => {
    await renderProvider();

    expect(await screen.findByText("signedOut:-:-")).toBeOnTheScreen();
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("com refresh token válido, entra sozinho na abertura", async () => {
    await saveRefreshToken("sessao.velho");
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { access_token: "access-novo", refresh_token: "sessao.novo" }),
    );

    await renderProvider();

    expect(await screen.findByText("signedIn:-:-")).toBeOnTheScreen();
    expect(getAccessToken()).toBe("access-novo");
  });

  it("com refresh token recusado, apaga a sessão e diz que ela foi encerrada", async () => {
    await saveRefreshToken("sessao.velho");
    fetchMock().mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "unauthenticated", message: "Entre de novo." } }),
    );

    await renderProvider();

    expect(await screen.findByText("signedOut:expired:-")).toBeOnTheScreen();
    expect(await readRefreshToken()).toBeNull();
  });

  it("sem rede na abertura, mantém a sessão guardada e oferece tentar de novo", async () => {
    await saveRefreshToken("sessao.velho");
    fetchMock().mockRejectedValueOnce(new TypeError("Network request failed"));

    await renderProvider();

    expect(await screen.findByText("loading:-:network_error")).toBeOnTheScreen();
    expect(await readRefreshToken()).toBe("sessao.velho");

    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { access_token: "access-novo", refresh_token: "sessao.novo" }),
    );
    await act(() => session?.retryRestore());
    expect(await screen.findByText("signedIn:-:-")).toBeOnTheScreen();
  });

  it("entrar grava a sessão, e sair apaga com o motivo", async () => {
    await renderProvider();
    await screen.findByText("signedOut:-:-");

    await act(() => session!.signIn({ accessToken: "access", refreshToken: "sessao.1" }));
    expect(screen.getByText("signedIn:-:-")).toBeOnTheScreen();
    expect(await readRefreshToken()).toBe("sessao.1");

    await act(() => session!.signOut("logout"));
    expect(screen.getByText("signedOut:logout:-")).toBeOnTheScreen();
    expect(getAccessToken()).toBeNull();
    expect(await readRefreshToken()).toBeNull();
  });

  it("volta para a entrada quando a sessão cai no meio do uso", async () => {
    await renderProvider();
    await screen.findByText("signedOut:-:-");
    await act(() => session!.signIn({ accessToken: "access", refreshToken: "sessao.1" }));
    fetchMock().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthenticated", message: "Entre de novo." } }),
    );

    await act(async () => {
      await api.get("/accounts").catch(() => undefined);
    });

    expect(screen.getByText("signedOut:expired:-")).toBeOnTheScreen();
  });
});
