// Função da Vercel `POST /api/siri`: o intermediário curto entre o atalho da Siri e a API
// (contracts/siri-shortcut.md; research, seção 1; ADR 0013).
//
// A Siri desiste de esperar em cerca de 10 s, e a API no Render pode levar 1 minuto para
// acordar. A função repassa a frase com um prazo absoluto (`X-Contai-Deadline`, a chegada mais
// 5,5 s) e espera no máximo 8 s. Sem resposta a tempo, responde "acordando": a API, que confere
// o prazo antes da IA e antes de gravar, descarta a frase que chegar tarde. Assim nada é lançado
// em dobro quando o usuário repete.
//
// A função sempre responde 200, com `outcome` e `speech`: o atalho lê só `speech`, e não depende
// de como o app Atalhos trata erros. Ela não guarda, não registra e não interpreta a frase nem
// o token.

const DEFAULT_RELAY_TIMEOUT_MS = 8000;
const DEFAULT_API_BUDGET_MS = 5500;
// O prazo da API fica pelo menos isto abaixo da espera da função: é a volta da resposta.
const MIN_MARGIN_MS = 2500;
const MAX_BODY_BYTES = 2048;

const WAKING_SPEECH = "O Contaí está acordando. Nada foi lançado. Tente de novo em um minuto.";
const EMPTY_SPEECH = "Não ouvi nada. Pode repetir?";

export interface SiriConfig {
  apiOrigin: string;
  originSecret: string;
  relayTimeoutMs: number;
  apiBudgetMs: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(env: Record<string, string | undefined>): SiriConfig {
  const relayTimeoutMs = positiveInt(env.VOICE_RELAY_TIMEOUT_MS, DEFAULT_RELAY_TIMEOUT_MS);
  const budget = positiveInt(env.VOICE_API_BUDGET_MS, DEFAULT_API_BUDGET_MS);
  return {
    apiOrigin: (env.API_ORIGIN_URL ?? "").replace(/\/+$/, ""),
    originSecret: env.ORIGIN_SECRET ?? "",
    relayTimeoutMs,
    apiBudgetMs: Math.min(budget, relayTimeoutMs - MIN_MARGIN_MS),
  };
}

function reply(outcome: string, speech: string): Response {
  return new Response(JSON.stringify({ outcome, speech }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPhrase(request: Request): Promise<string | null> {
  if (request.method !== "POST") return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const body: unknown = JSON.parse(text);
    if (!isRecord(body) || typeof body.phrase !== "string" || !body.phrase.trim()) return null;
    return body.phrase;
  } catch {
    return null;
  }
}

export async function handleSiri(
  request: Request,
  config: SiriConfig,
  now: () => number = Date.now,
): Promise<Response> {
  const arrival = now();
  const phrase = await readPhrase(request);
  if (phrase === null) return reply("repeat", EMPTY_SPEECH);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: request.headers.get("authorization") ?? "",
    "X-Contai-Deadline": String(arrival + config.apiBudgetMs),
    "x-contai-proxy-secret": config.originSecret,
  };
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientIp) headers["X-Forwarded-For"] = clientIp;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.relayTimeoutMs - (now() - arrival));
  try {
    const response = await fetch(`${config.apiOrigin}/api/v1/voice/entries`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phrase }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.outcome === "string" && typeof body.speech === "string") {
      return reply(body.outcome, body.speech);
    }
    return reply("waking", WAKING_SPEECH);
  } catch {
    // Tempo esgotado, erro de rede ou resposta fora do formato: o servidor está acordando.
    return reply("waking", WAKING_SPEECH);
  } finally {
    clearTimeout(timer);
  }
}

export function POST(request: Request): Promise<Response> {
  return handleSiri(request, readConfig(process.env));
}

export function GET(request: Request): Promise<Response> {
  return handleSiri(request, readConfig(process.env));
}
