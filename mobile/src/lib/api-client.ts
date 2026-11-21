// Cliente HTTP do app: `fetch` sobre `<EXPO_PUBLIC_API_URL>/api/v1`, pelo mesmo proxy do site.
// Toda chamada se identifica com `X-Contai-Client: mobile`. Num 401 de sessão, o cliente renova
// uma única vez, mesmo com várias requisições juntas, e repete cada uma uma vez. Se a renovação
// falha, a sessão é apagada e o app volta à entrada (research, seção 5). Só a camada `services`
// de cada feature chama este módulo.
import Constants from "expo-constants";
import { Platform } from "react-native";

import { getConfig } from "./config";
import {
  clearSession,
  getAccessToken,
  readRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from "./session";
import { trackRequest } from "./waking";

const API_PREFIX = "/api/v1";
const REFRESH_PATH = "/auth/mobile/refresh";
export const REQUEST_TIMEOUT_MS = 90_000;

export const SESSION_EXPIRED_MESSAGE = "Sua sessão foi encerrada. Entre de novo para continuar.";
const NETWORK_ERROR_MESSAGE =
  "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.";
const TIMEOUT_MESSAGE =
  "O servidor demorou demais para responder. Confira sua conexão e tente de novo.";
const UNEXPECTED_ERROR_MESSAGE =
  "Algo deu errado do nosso lado. Tente de novo em alguns instantes.";

// O backend mostra o aparelho na lista de sessões do site a partir daqui ("iPhone").
const DEVICE = Platform.OS === "ios" ? (Platform.isPad ? "iPad" : "iPhone") : "Android";
const USER_AGENT = `Contai/${Constants.expoConfig?.version ?? "1"} (${DEVICE}; ${Platform.OS} ${String(Platform.Version)})`;

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
  /** Status HTTP; `0` quando a resposta nem chegou. */
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

/** Mensagem para mostrar ao usuário; um erro que não veio da API vira uma mensagem genérica. */
export function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : UNEXPECTED_ERROR_MESSAGE;
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

// ---------- fim da sessão ----------

export type SessionEndReason = "expired";

let sessionEndedListener: ((reason: SessionEndReason) => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;
// Toda troca de sessão avança a geração: uma renovação que começou antes de um logout e só
// responde depois não ressuscita a sessão encerrada.
let sessionGeneration = 0;

/** O provedor de sessão escuta aqui para levar o usuário à entrada com o motivo. */
export function setSessionEndedListener(
  listener: ((reason: SessionEndReason) => void) | null,
): void {
  sessionEndedListener = listener;
}

/** Começa ou encerra uma sessão: entrar, sair ou expirar. */
export function bumpSessionGeneration(): void {
  sessionGeneration += 1;
}

async function endSession(): Promise<void> {
  const hadSession = getAccessToken() !== null;
  bumpSessionGeneration();
  await clearSession();
  // Várias requisições podem falhar juntas; o aviso sai uma vez só.
  if (hadSession) sessionEndedListener?.("expired");
}

function sessionExpiredError(requestId: string | null): ApiError {
  return new ApiError({
    status: 401,
    code: "session_expired",
    message: SESSION_EXPIRED_MESSAGE,
    requestId,
  });
}

// ---------- renovação ----------

async function requestNewToken(): Promise<boolean> {
  const generation = sessionGeneration;
  const refreshToken = await readRefreshToken();
  if (!refreshToken) return false;

  const response = await send("POST", REFRESH_PATH, {
    body: { refresh_token: refreshToken },
    token: null,
  });
  if (response.ok) {
    const body = await readJson(response);
    if (
      isRecord(body) &&
      typeof body.access_token === "string" &&
      typeof body.refresh_token === "string"
    ) {
      if (generation !== sessionGeneration) return false;
      setAccessToken(body.access_token);
      await saveRefreshToken(body.refresh_token);
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
 * Renova o access token com o refresh token do Keychain. Devolve `false` quando não há sessão
 * válida, e lança `ApiError` quando o servidor não respondeu (a sessão continua guardada).
 * Chamadas simultâneas compartilham a mesma renovação.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const inFlight = requestNewToken().finally(() => {
    if (refreshInFlight === inFlight) refreshInFlight = null;
  });
  refreshInFlight = inFlight;
  return inFlight;
}

/** Testes: zera o estado do cliente entre um teste e outro. */
export function resetApiClient(): void {
  refreshInFlight = null;
  sessionEndedListener = null;
  sessionGeneration += 1;
}

// ---------- requisições ----------

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Parâmetros de consulta; `null` e `undefined` são omitidos. */
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

interface SendOptions extends RequestOptions {
  body?: unknown;
  token: string | null;
}

function buildUrl(path: string, params: RequestOptions["params"]): string {
  const query = Object.entries(params ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${getConfig().apiUrl}${API_PREFIX}${path}${query ? `?${query}` : ""}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function send(method: string, path: string, options: SendOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Contai-Client": "mobile",
    "User-Agent": USER_AGENT,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: string | FormData | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const timeout = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = (): void => timeout.abort();
  options.signal?.addEventListener("abort", abortFromCaller);
  const done = trackRequest();

  try {
    return await fetch(buildUrl(path, options.params), {
      method,
      headers,
      body,
      signal: timeout.signal,
    });
  } catch (cause) {
    if (timedOut) {
      throw new ApiError({ status: 0, code: "timeout", message: TIMEOUT_MESSAGE });
    }
    // Cancelamento pedido por quem chamou não é erro de rede: a consulta saiu da tela.
    if (isAbortError(cause)) throw cause;
    throw new ApiError({ status: 0, code: "network_error", message: NETWORK_ERROR_MESSAGE });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
    done();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text === "" ? null : (JSON.parse(text) as unknown);
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
  // Resposta fora do formato, por exemplo do proxy com a API fora do ar.
  return new ApiError({
    status: response.status,
    code: response.status >= 500 ? "internal_error" : "unexpected_response",
    message: UNEXPECTED_ERROR_MESSAGE,
    requestId: headerRequestId,
  });
}

async function parseSuccess<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
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
  const tokenUsed = getAccessToken();
  const first = await send(method, path, { ...options, body, token: tokenUsed });
  if (first.ok) return parseSuccess<T>(first);

  const firstError = await toApiError(first);
  // Só um token recusado leva à renovação; "senha errada" e outros 401 seguem como estão.
  const tokenRejected = first.status === 401 && firstError.code === "unauthenticated";
  if (!tokenRejected || tokenUsed === null) throw firstError;

  // Outra requisição pode já ter resolvido isto: renovado o token ou encerrado a sessão.
  const current = getAccessToken();
  if (current === null) throw sessionExpiredError(firstError.requestId);
  const renewed = current !== tokenUsed || (await refreshAccessToken());
  if (!renewed) {
    await endSession();
    throw sessionExpiredError(firstError.requestId);
  }

  // Uma única repetição, com o token novo.
  const second = await send(method, path, { ...options, body, token: getAccessToken() });
  if (second.ok) return parseSuccess<T>(second);
  const secondError = await toApiError(second);
  if (second.status === 401 && secondError.code === "unauthenticated") {
    await endSession();
    throw sessionExpiredError(secondError.requestId);
  }
  throw secondError;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, undefined, options),
};
