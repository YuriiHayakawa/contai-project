import {
  ApiError,
  SESSION_EXPIRED_MESSAGE,
  api,
  fieldErrors,
  getAccessToken,
  isSessionExpiredError,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken,
} from "./api-client";

type FetchArgs = [input: string, init: RequestInit];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function apiErrorBody(code: string, message: string, details?: unknown): unknown {
  return { error: { code, message, details }, request_id: "req-123" };
}

const tokenRejected = (): Response =>
  json(401, apiErrorBody("unauthenticated", "Entre de novo para continuar."));

function call(index: number): { url: string; init: RequestInit; headers: Headers } {
  const args = fetchMock.mock.calls[index];
  if (!args) throw new Error(`fetch não foi chamado ${index + 1} vezes`);
  return { url: args[0], init: args[1], headers: new Headers(args[1].headers) };
}

function refreshCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/refresh").length;
}

/** Roteia o `fetch` falso: cada rota responde conforme o token apresentado. */
function routeFetch(handler: (url: string, headers: Headers) => Response): void {
  fetchMock.mockImplementation((url, init) =>
    Promise.resolve(handler(url, new Headers(init.headers))),
  );
}

const transaction = {
  type: "expense",
  amount_cents: 4590,
  date: "2026-10-01",
  description: "Padaria",
  account_id: "acc-1",
  category_id: "cat-1",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "locks");
});

describe("requisições", () => {
  it("usa o prefixo /api/v1, envia o token em memória e o corpo em JSON", async () => {
    setAccessToken("token-1");
    fetchMock.mockResolvedValueOnce(json(200, { id: "tx-1" }));

    const result = await api.post<{ id: string }>("/transactions", transaction);

    expect(result).toEqual({ id: "tx-1" });
    const { url, init, headers } = call(0);
    expect(url).toBe("/api/v1/transactions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(transaction));
    expect(headers.get("Authorization")).toBe("Bearer token-1");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("não envia Authorization sem token e monta os parâmetros de consulta", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { items: [] }));

    await api.get("/transactions", { params: { from: "2026-10-01", q: undefined, limit: 50 } });

    const { url, headers } = call(0);
    expect(url).toBe("/api/v1/transactions?from=2026-10-01&limit=50");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("devolve undefined em respostas sem corpo", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.delete("/transactions/tx-1")).resolves.toBeUndefined();
  });

  it("envia FormData sem definir o Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(json(202, { id: "imp-1" }));
    const form = new FormData();
    form.set("kind", "statement");

    await api.post("/imports", form);

    const { init, headers } = call(0);
    expect(init.body).toBe(form);
    expect(headers.has("Content-Type")).toBe(false);
  });
});

describe("conversão de erros", () => {
  it("converte o formato de erro da API em ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        422,
        apiErrorBody("validation_error", "Confira os campos destacados.", {
          fields: { amount_cents: "Informe um valor maior que zero." },
        }),
      ),
    );

    const error = await api.post("/transactions", transaction).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "validation_error",
      message: "Confira os campos destacados.",
      details: { fields: { amount_cents: "Informe um valor maior que zero." } },
      requestId: "req-123",
    });
    expect(fieldErrors(error)).toEqual({ amount_cents: "Informe um valor maior que zero." });
  });

  it("dá uma mensagem que diz o que fazer quando a resposta não é da API", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "X-Request-ID": "req-proxy" },
      }),
    );

    await expect(api.get("/accounts")).rejects.toMatchObject({
      status: 502,
      code: "internal_error",
      message: "Algo deu errado do nosso lado. Tente de novo em alguns instantes.",
      requestId: "req-proxy",
    });
  });

  it("converte falha de rede em ApiError, sem expor o erro técnico", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.get("/accounts")).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
    });
  });

  it("deixa passar o cancelamento da requisição", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    await expect(api.get("/accounts")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("não tenta refresh em um 401 que não é de token recusado", async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, apiErrorBody("invalid_credentials", "E-mail ou senha incorretos.")),
    );

    await expect(api.post("/auth/login", { email: "a@b.co", password: "x" })).rejects.toMatchObject(
      { code: "invalid_credentials" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("refresh em um 401", () => {
  it("renova o token com X-Contai-Client e repete a requisição uma única vez", async () => {
    setAccessToken("token-velho");
    fetchMock
      .mockResolvedValueOnce(tokenRejected())
      .mockResolvedValueOnce(json(200, { access_token: "token-novo" }))
      .mockResolvedValueOnce(json(201, { id: "tx-1" }));

    const result = await api.post<{ id: string }>("/transactions", transaction);

    expect(result).toEqual({ id: "tx-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const refresh = call(1);
    expect(refresh.url).toBe("/api/v1/auth/refresh");
    expect(refresh.init.method).toBe("POST");
    expect(refresh.init.credentials).toBe("same-origin");
    expect(refresh.headers.get("X-Contai-Client")).toBe("web");
    expect(refresh.headers.has("Authorization")).toBe(false);

    const retry = call(2);
    expect(retry.url).toBe("/api/v1/transactions");
    expect(retry.init.body).toBe(JSON.stringify(transaction));
    expect(retry.headers.get("Authorization")).toBe("Bearer token-novo");
    expect(getAccessToken()).toBe("token-novo");
  });

  it("serializa o refresh entre abas com navigator.locks", async () => {
    const order: string[] = [];
    const request = vi.fn(async (name: string, task: () => Promise<boolean>) => {
      order.push(`lock:${name}`);
      const result = await task();
      order.push("unlock");
      return result;
    });
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    setAccessToken("token-velho");
    fetchMock.mockImplementation((url) => {
      order.push(url);
      return Promise.resolve(json(200, { access_token: "token-novo" }));
    });

    await expect(refreshAccessToken()).resolves.toBe(true);

    expect(order).toEqual(["lock:contai-auth-refresh", "/api/v1/auth/refresh", "unlock"]);
  });

  it("faz um único refresh para requisições que falham juntas", async () => {
    setAccessToken("token-velho");
    routeFetch((url, headers) => {
      if (url === "/api/v1/auth/refresh") return json(200, { access_token: "token-novo" });
      return headers.get("Authorization") === "Bearer token-novo"
        ? json(200, { url })
        : tokenRejected();
    });

    const results = await Promise.all([api.get("/accounts"), api.get("/categories")]);

    expect(results).toEqual([{ url: "/api/v1/accounts" }, { url: "/api/v1/categories" }]);
    expect(refreshCalls()).toBe(1);
  });

  it("não renova de novo quando outra requisição já trocou o token", async () => {
    setAccessToken("token-velho");
    let releaseSlow: (response: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      releaseSlow = resolve;
    });
    fetchMock.mockImplementation((url, init) => {
      const authorization = new Headers(init.headers).get("Authorization");
      if (url === "/api/v1/auth/refresh") {
        return Promise.resolve(json(200, { access_token: "token-novo" }));
      }
      if (authorization === "Bearer token-novo") return Promise.resolve(json(200, { url }));
      return url === "/api/v1/categories" ? slow : Promise.resolve(tokenRejected());
    });

    const late = api.get("/categories");
    await api.get("/accounts");
    releaseSlow(tokenRejected());

    await expect(late).resolves.toEqual({ url: "/api/v1/categories" });
    expect(refreshCalls()).toBe(1);
  });

  it("mantém a sessão quando o servidor não responde ao refresh", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setAccessToken("token-velho");
    fetchMock
      .mockResolvedValueOnce(tokenRejected())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.get("/accounts")).rejects.toMatchObject({ code: "network_error" });

    expect(expired).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe("token-velho");
    unsubscribe();
  });
});

describe("sessão expirada", () => {
  it("no meio do envio de um lançamento: limpa a sessão e sinaliza, sem erro técnico", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setAccessToken("token-velho");
    fetchMock
      .mockResolvedValueOnce(tokenRejected())
      .mockResolvedValueOnce(json(401, apiErrorBody("unauthenticated", "Sessão encerrada.")));

    const error = await api.post("/transactions", transaction).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "session_expired" });
    expect((error as ApiError).message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(SESSION_EXPIRED_MESSAGE).toBe("Sua sessão expirou. Entre de novo para continuar.");
    expect(isSessionExpiredError(error)).toBe(true);

    expect(expired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    // O lançamento não é reenviado depois que o refresh falha.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("sinaliza uma vez só quando várias requisições falham juntas", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setAccessToken("token-velho");
    routeFetch(() => tokenRejected());

    const results = await Promise.allSettled([api.get("/accounts"), api.get("/categories")]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    for (const result of results) {
      expect(isSessionExpiredError(result.status === "rejected" && result.reason)).toBe(true);
    }
    expect(expired).toHaveBeenCalledTimes(1);
    expect(refreshCalls()).toBe(1);
    unsubscribe();
  });

  it("sinaliza quando o token novo também é recusado, sem repetir de novo", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setAccessToken("token-velho");
    fetchMock
      .mockResolvedValueOnce(tokenRejected())
      .mockResolvedValueOnce(json(200, { access_token: "token-novo" }))
      .mockResolvedValueOnce(tokenRejected());

    await expect(api.get("/accounts")).rejects.toMatchObject({ code: "session_expired" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("deixa de avisar quem cancelou a inscrição", async () => {
    const expired = vi.fn();
    onSessionExpired(expired)();
    setAccessToken("token-velho");
    routeFetch(() => tokenRejected());

    await expect(api.get("/accounts")).rejects.toMatchObject({ code: "session_expired" });

    expect(expired).not.toHaveBeenCalled();
  });
});

describe("refresh silencioso ao carregar", () => {
  it("devolve false, sem sinalizar expiração, quando não há sessão", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    fetchMock.mockResolvedValueOnce(tokenRejected());

    await expect(refreshAccessToken()).resolves.toBe(false);

    expect(expired).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    unsubscribe();
  });
});
