// Cliente HTTP do app: `fetch` sobre /api/v1. O access token fica só em memória; em um 401, o
// cliente renova a sessão uma vez (serializado entre abas), repete a requisição uma única vez
// e converte o formato de erro da API em `ApiError`. Só a camada de `services` de cada feature
// chama este módulo.

const API_PREFIX = "/api/v1";
const REFRESH_PATH = "/auth/refresh";
// Duas abas nunca apresentam o mesmo refresh token ao mesmo tempo: a segunda seria tratada
// como reutilização e derrubaria a sessão (research.md, seção 3).
const REFRESH_LOCK_NAME = "contai-auth-refresh";

export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre de novo para continuar.";
const NETWORK_ERROR_MESSAGE =
  "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.";
const UNEXPECTED_ERROR_MESSAGE =
  "Algo deu errado do nosso lado. Tente de novo em alguns instantes.";

export type ApiErrorDetails = Record<string, unknown>;

interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetails | null;
  requestId?: string | null;
}

/** Erro de uma chamada à API, já com a mensagem em português que diz o que fazer. */
export class ApiError extends Error {
  /** Status HTTP; `0` quando a requisição nem chegou ao servidor. */
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails | null;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Mensagem para mostrar ao usuário. As da API já vêm em português e dizem o que fazer; um
 * erro que não veio da API vira uma mensagem genérica, sem o texto técnico.
 */
export function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : UNEXPECTED_ERROR_MESSAGE;
}

/** A sessão acabou: o usuário já está sendo levado à tela de entrada, sem erro técnico. */
export function isSessionExpiredError(error: unknown): boolean {
  return isApiError(error) && error.code === "session_expired";
}

/** Mensagens por campo de um `validation_error`, para mostrar junto de cada campo. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || !isRecord(error.details)) return {};
  const fields = error.details.fields;
  if (!isRecord(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

// ---------- sessão em memória ----------

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const sessionExpiredListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

/** Guarda o token depois do login, ou o apaga (`null`) na saída. Nunca vai para o disco. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Avisa quando a sessão expira no meio do uso. Devolve a função que cancela o aviso.
 * O `AuthProvider` usa isto para levar o usuário à tela de entrada.
 */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function expireSession(): void {
  // Várias requisições podem falhar juntas; o aviso sai uma vez só.
  if (accessToken === null) return;
  accessToken = null;
  sessionExpiredListeners.forEach((listener) => listener());
}

function sessionExpiredError(requestId: string | null): ApiError {
  return new ApiError({
    status: 401,
    code: "session_expired",
    message: SESSION_EXPIRED_MESSAGE,
    requestId,
  });
}

// ---------- refresh ----------

function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request(REFRESH_LOCK_NAME, task);
  }
  // Sem a Web Locks API, resta a serialização dentro da própria aba.
  return task();
}

async function requestNewToken(): Promise<boolean> {
  const response = await send("POST", REFRESH_PATH, {
    headers: { "X-Contai-Client": "web" },
    token: null,
  });
  if (response.ok) {
    const body: unknown = await readJson(response);
    if (isRecord(body) && typeof body.access_token === "string") {
      accessToken = body.access_token;
      return true;
    }
    throw new ApiError({
      status: response.status,
      code: "unexpected_response",
      message: UNEXPECTED_ERROR_MESSAGE,
    });
  }
  // 4xx: o refresh token é inválido, expirou ou foi reutilizado. Não há o que tentar de novo.
  if (response.status < 500) return false;
  throw await toApiError(response);
}

/**
 * Renova o access token com o cookie de refresh. Devolve `false` quando não há sessão válida
 * e lança `ApiError` quando o servidor não respondeu (a sessão continua como estava).
 * Chamadas simultâneas compartilham a mesma renovação.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= withRefreshLock(requestNewToken).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ---------- requisições ----------

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Parâmetros de consulta; `null` e `undefined` são omitidos. */
  params?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** `blob` para downloads, como a exportação em ZIP. */
  responseType?: "json" | "blob";
}

interface SendOptions extends RequestOptions {
  body?: unknown;
  token: string | null;
}

function buildUrl(path: string, params: RequestOptions["params"]): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `${API_PREFIX}${path}${suffix}`;
}

async function send(method: string, path: string, options: SendOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Accept", options.responseType === "blob" ? "*/*" : "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body; // o navegador define o Content-Type com o delimitador
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  try {
    return await fetch(buildUrl(path, options.params), {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (cause) {
    // Cancelamento não é erro de rede: o TanStack Query cancela consultas que saíram da tela.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError({ status: 0, code: "network_error", message: NETWORK_ERROR_MESSAGE });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await readJson(response);
  const headerRequestId = response.headers.get("X-Request-ID");

  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, details } = body.error;
    if (typeof code === "string" && typeof message === "string") {
      return new ApiError({
        status: response.status,
        code,
        message,
        details: isRecord(details) ? details : null,
        requestId: typeof body.request_id === "string" ? body.request_id : headerRequestId,
      });
    }
  }
  // Resposta fora do formato (por exemplo, do proxy quando a API está fora do ar).
  return new ApiError({
    status: response.status,
    code: response.status >= 500 ? "internal_error" : "unexpected_response",
    message: UNEXPECTED_ERROR_MESSAGE,
    requestId: headerRequestId,
  });
}

async function parseSuccess<T>(response: Response, responseType: "json" | "blob"): Promise<T> {
  if (responseType === "blob") return (await response.blob()) as T;
  if (response.status === 204 || response.headers.get("Content-Length") === "0") {
    return undefined as T;
  }
  const text = await response.text();
  if (text === "") return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      code: "unexpected_response",
      message: UNEXPECTED_ERROR_MESSAGE,
      requestId: response.headers.get("X-Request-ID"),
    });
  }
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const tokenUsed = accessToken;
  const responseType = options.responseType ?? "json";

  const first = await send(method, path, { ...options, body, token: tokenUsed });
  if (first.ok) return parseSuccess<T>(first, responseType);

  const firstError = await toApiError(first);
  // Só um token recusado leva ao refresh; "senha errada" e outros 401 seguem como estão.
  const tokenRejected = first.status === 401 && firstError.code === "unauthenticated";
  if (!tokenRejected || tokenUsed === null) throw firstError;

  // Outra requisição pode já ter resolvido isto: renovado o token ou encerrado a sessão.
  if (accessToken === null) throw sessionExpiredError(firstError.requestId);
  const renewed = accessToken !== tokenUsed || (await refreshAccessToken());
  if (!renewed) {
    expireSession();
    throw sessionExpiredError(firstError.requestId);
  }

  // Uma única repetição, com o token novo.
  const second = await send(method, path, { ...options, body, token: accessToken });
  if (second.ok) return parseSuccess<T>(second, responseType);

  const secondError = await toApiError(second);
  if (second.status === 401 && secondError.code === "unauthenticated") {
    expireSession();
    throw sessionExpiredError(secondError.requestId);
  }
  throw secondError;
}

/** Chamadas à API. `body` vira JSON, exceto `FormData`, que segue como upload. */
export const api = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("GET", path, undefined, options);
  },
  post<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, body, options);
  },
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PATCH", path, body, options);
  },
  delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, undefined, options);
  },
};
