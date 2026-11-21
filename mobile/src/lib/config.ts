// Configuração do app, lida das variáveis EXPO_PUBLIC_* (mobile/.env). O Expo troca cada
// `process.env.EXPO_PUBLIC_...` pelo valor na hora de empacotar, por isso o acesso precisa ser
// literal, sem desestruturar `process.env`.
import { z } from "zod";

const httpsUrl = z.url({ protocol: /^https$/, message: "Use um endereço https." });
const anyHttpUrl = z.url({ protocol: /^https?$/, message: "Use um endereço http ou https." });

export const configSchema = (allowHttp: boolean) =>
  z.object({
    // Fora do desenvolvimento, só HTTPS (constituição, Princípio XII).
    apiUrl: (allowHttp ? anyHttpUrl : httpsUrl).transform((url) => url.replace(/\/+$/, "")),
    // Link do iCloud do atalho pronto (FR-017). Opcional: sem ele, só o passo a passo manual.
    shortcutUrl: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(httpsUrl.nullable()),
  });

export type AppConfig = z.infer<ReturnType<typeof configSchema>>;

export function readConfig(
  env: { apiUrl: string | undefined; shortcutUrl: string | undefined },
  allowHttp: boolean,
): AppConfig {
  const parsed = configSchema(allowHttp).safeParse({
    apiUrl: env.apiUrl ?? "",
    shortcutUrl: env.shortcutUrl ?? "",
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Configuração do app inválida em mobile/.env: ${problems.join("; ")}`);
  }
  return parsed.data;
}

let cached: AppConfig | null = null;

/** A configuração do app, lida e validada na primeira chamada. */
export function getConfig(): AppConfig {
  cached ??= readConfig(
    {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      shortcutUrl: process.env.EXPO_PUBLIC_SHORTCUT_URL,
    },
    __DEV__,
  );
  return cached;
}
