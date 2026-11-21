import { isWaking } from "./waking";
import {
  ApiError,
  api,
  refreshAccessToken,
  resetApiClient,
  setSessionEndedListener,
} from "./api-client";
import {
  clearSession,
  getAccessToken,
  readRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from "./session";

const API = "https://contai-project.vercel.app/api/v1";

jest.mock("./config", () => ({
  getConfig: () => ({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null }),
}));

type FetchMock = jest.MockedFunction<typeof fetch>;

function fetchMock(): FetchMock {
  return globalThis.fetch as FetchMock;
}

function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response;
}

function apiError(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message }, request_id: "req-1" });
}

function headersOf(call: number): Record<string, string> {
  const init = fetchMock().mock.calls[call]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

function urlOf(call: number): string {
  return String(fetchMock().mock.calls[call]?.[0]);
}

beforeEach(async () => {
  resetApiClient();
  setAccessToken("access-velho");
  await saveRefreshToken("sessao.velho");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("cliente HTTP do app", () => {
  it("identifica o app e manda o access token", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(200, { name: "Ana" }));

    await expect(api.get("/users/me")).resolves.toEqual({ name: "Ana" });

    expect(urlOf(0)).toBe(`${API}/users/me`);
    expect(headersOf(0)).toMatchObject({
      "X-Contai-Client": "mobile",
      Authorization: "Bearer access-velho",
    });
    expect(headersOf(0)["User-Agent"]).toMatch(/^Contai\//);
  });

  it("monta a consulta sem os parâmetros vazios", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(200, []));

    await api.get("/transactions", { params: { month: "2026-11", category_id: null } });

    expect(urlOf(0)).toBe(`${API}/transactions?month=2026-11`);
  });

  it("renova a sessão uma única vez para três 401 simultâneos e repete cada pedido uma vez", async () => {
    let refreshes = 0;
    fetchMock().mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/auth/mobile/refresh")) {
        refreshes += 1;
        return jsonResponse(200, {
          access_token: "access-novo",
          refresh_token: "sessao.novo",
          token_type: "bearer",
        });
      }
      if (headers.Authorization === "Bearer access-velho") {
        return apiError(401, "unauthenticated", "Entre de novo.");
      }
      return jsonResponse(200, { url });
    });

    const results = await Promise.all([
      api.get("/accounts"),
      api.get("/categories"),
      api.get("/dashboard/summary"),
    ]);

    expect(refreshes).toBe(1);
    expect(results).toHaveLength(3);
    // Três pedidos, uma renovação e três repetições.
    expect(fetchMock()).toHaveBeenCalledTimes(7);
    expect(getAccessToken()).toBe("access-novo");
    expect(await readRefreshToken()).toBe("sessao.novo");
    const refreshCall = fetchMock().mock.calls.find(([url]) =>
      String(url).endsWith("/auth/mobile/refresh"),
    );
    expect(JSON.parse(String(refreshCall?.[1]?.body))).toEqual({ refresh_token: "sessao.velho" });
  });

  it("apaga a sessão e avisa quando a renovação falha", async () => {
    const ended = jest.fn();
    setSessionEndedListener(ended);
    fetchMock().mockImplementation(async (input) =>
      String(input).endsWith("/auth/mobile/refresh")
        ? apiError(401, "unauthenticated", "Entre de novo.")
        : apiError(401, "unauthenticated", "Entre de novo."),
    );

    await expect(api.get("/accounts")).rejects.toMatchObject({ code: "session_expired" });

    expect(ended).toHaveBeenCalledWith("expired");
    expect(getAccessToken()).toBeNull();
    expect(await readRefreshToken()).toBeNull();
  });

  it("não renova num 401 que não é de sessão, como senha errada no login", async () => {
    fetchMock().mockResolvedValueOnce(
      apiError(401, "invalid_credentials", "E-mail ou senha incorretos."),
    );

    await expect(api.post("/auth/mobile/login", { email: "a", password: "b" })).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_credentials",
        message: "E-mail ou senha incorretos.",
      }),
    );
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it("devolve os erros no formato padronizado da API", async () => {
    fetchMock().mockResolvedValueOnce(
      apiError(422, "validation_error", "Informe um valor maior que zero."),
    );

    const error = await api.post("/transactions", {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "validation_error",
      message: "Informe um valor maior que zero.",
      requestId: "req-1",
    });
  });

  it("transforma falha de rede numa mensagem que diz o que fazer", async () => {
    fetchMock().mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(api.get("/accounts")).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: expect.stringContaining("conexão"),
    });
  });

  it("liga o aviso de servidor acordando depois de 4 s e desliga na resposta", async () => {
    jest.useFakeTimers();
    let answer: (response: Response) => void = () => undefined;
    fetchMock().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );

    const pending = api.get("/accounts");
    await jest.advanceTimersByTimeAsync(3_999);
    expect(isWaking()).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(isWaking()).toBe(true);

    answer(jsonResponse(200, []));
    await pending;
    expect(isWaking()).toBe(false);
  });

  it("desiste depois de 90 s", async () => {
    jest.useFakeTimers();
    fetchMock().mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const aborted = new Error("Aborted");
            aborted.name = "AbortError";
            reject(aborted);
          });
        }),
    );

    const pending = api.get("/accounts").catch((caught: unknown) => caught);
    await jest.advanceTimersByTimeAsync(90_000);

    expect(await pending).toMatchObject({ code: "timeout" });
    expect(isWaking()).toBe(false);
  });

  it("renova na abertura do app com o refresh token do Keychain", async () => {
    setAccessToken(null);
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { access_token: "access-novo", refresh_token: "sessao.novo" }),
    );

    await expect(refreshAccessToken()).resolves.toBe(true);

    expect(headersOf(0)["X-Contai-Client"]).toBe("mobile");
    expect(headersOf(0).Authorization).toBeUndefined();
    expect(getAccessToken()).toBe("access-novo");
  });

  it("não renova sem refresh token guardado", async () => {
    await clearSession();

    await expect(refreshAccessToken()).resolves.toBe(false);
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
