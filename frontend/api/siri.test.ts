// @vitest-environment node
import { type SiriConfig, handleSiri, readConfig } from "./siri";

const WAKING = "O Contaí está acordando. Nada foi lançado. Tente de novo em um minuto.";
const EMPTY = "Não ouvi nada. Pode repetir?";

const config: SiriConfig = {
  apiOrigin: "https://contai-api.onrender.com",
  originSecret: "segredo-do-proxy",
  relayTimeoutMs: 8000,
  apiBudgetMs: 5500,
};

const ARRIVAL = 1_795_000_000_000;

function siriRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://contai-project.vercel.app/api/siri", {
    method: "POST",
    headers: {
      Authorization: "Bearer ctp_token",
      "Content-Type": "application/json",
      "X-Forwarded-For": "200.10.20.30, 10.0.0.1",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function apiAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function read(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  return response.json();
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("função da Siri", () => {
  it("repassa a resposta da API com 200, sem o id do lançamento", async () => {
    fetchMock.mockResolvedValue(
      apiAnswer(201, {
        outcome: "saved",
        speech: "Anotei 45 reais em Alimentação, no Nubank.",
        transaction_id: "c5b2d1e0-0000-0000-0000-000000000000",
      }),
    );

    const response = await handleSiri(siriRequest({ phrase: "gastei 45" }), config, () => ARRIVAL);

    expect(await read(response)).toEqual({
      outcome: "saved",
      speech: "Anotei 45 reais em Alimentação, no Nubank.",
    });
  });

  it("um erro da API também vira 200, com a fala dela", async () => {
    fetchMock.mockResolvedValue(
      apiAnswer(422, { outcome: "repeat", speech: "Não entendi o valor.", transaction_id: null }),
    );

    const response = await handleSiri(siriRequest({ phrase: "gastei" }), config, () => ARRIVAL);

    expect(await read(response)).toEqual({ outcome: "repeat", speech: "Não entendi o valor." });
  });

  it("envia o prazo, o segredo do proxy, o token e o IP de quem chamou", async () => {
    fetchMock.mockResolvedValue(apiAnswer(201, { outcome: "saved", speech: "ok" }));

    await handleSiri(siriRequest({ phrase: "gastei 45" }), config, () => ARRIVAL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://contai-api.onrender.com/api/v1/voice/entries");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Contai-Deadline")).toBe(String(ARRIVAL + 5500));
    expect(headers.get("x-contai-proxy-secret")).toBe("segredo-do-proxy");
    expect(headers.get("Authorization")).toBe("Bearer ctp_token");
    expect(headers.get("X-Forwarded-For")).toBe("200.10.20.30");
    expect(JSON.parse(String(init?.body))).toEqual({ phrase: "gastei 45" });
  });

  it("depois de 8 s sem resposta, diz que o Contaí está acordando", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = handleSiri(siriRequest({ phrase: "gastei 45" }), config, () => ARRIVAL);
    await vi.advanceTimersByTimeAsync(8000);

    expect(await read(await pending)).toEqual({ outcome: "waking", speech: WAKING });
  });

  it("um erro de rede também é 'acordando'", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await handleSiri(siriRequest({ phrase: "gastei 45" }), config, () => ARRIVAL);

    expect(await read(response)).toEqual({ outcome: "waking", speech: WAKING });
  });

  it("uma resposta fora do formato, como a página do Render acordando, é 'acordando'", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

    const response = await handleSiri(siriRequest({ phrase: "gastei 45" }), config, () => ARRIVAL);

    expect(await read(response)).toEqual({ outcome: "waking", speech: WAKING });
  });

  it.each([
    ["sem frase", {}],
    ["frase vazia", { phrase: "   " }],
    ["frase que não é texto", { phrase: 45 }],
    ["corpo que não é JSON", "gastei 45"],
    ["corpo maior que 2 KB", { phrase: "x".repeat(2100) }],
  ])("%s pede para repetir, sem chamar a API", async (_case, body) => {
    const response = await handleSiri(siriRequest(body), config, () => ARRIVAL);

    expect(await read(response)).toEqual({ outcome: "repeat", speech: EMPTY });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("outro método pede para repetir", async () => {
    const response = await handleSiri(
      new Request("https://contai-project.vercel.app/api/siri", { method: "GET" }),
      config,
      () => ARRIVAL,
    );

    expect(await read(response)).toEqual({ outcome: "repeat", speech: EMPTY });
  });
});

describe("configuração da função", () => {
  it("usa os padrões de 8 s e 5,5 s", () => {
    expect(
      readConfig({ API_ORIGIN_URL: "https://contai-api.onrender.com/", ORIGIN_SECRET: "s" }),
    ).toEqual({
      apiOrigin: "https://contai-api.onrender.com",
      originSecret: "s",
      relayTimeoutMs: 8000,
      apiBudgetMs: 5500,
    });
  });

  it("mantém o prazo da API pelo menos 2,5 s abaixo da espera", () => {
    const tuned = readConfig({
      API_ORIGIN_URL: "https://contai-api.onrender.com",
      ORIGIN_SECRET: "s",
      VOICE_RELAY_TIMEOUT_MS: "9000",
      VOICE_API_BUDGET_MS: "8000",
    });

    expect(tuned.relayTimeoutMs).toBe(9000);
    expect(tuned.apiBudgetMs).toBe(6500);
  });
});
