// Links do app para o site. As ações de conta que o app ainda não tem (criar conta, recuperar a
// senha, duas etapas, sessões, exportar e excluir) acontecem no site (FR-006). O site e a API
// ficam no mesmo endereço, o do `EXPO_PUBLIC_API_URL`.
import { paths } from "@web/lib/paths";
import * as Linking from "expo-linking";

import { getConfig } from "./config";

export type SitePath = (typeof paths)[keyof typeof paths];

export function siteUrl(path: SitePath): string {
  return `${getConfig().apiUrl}${path}`;
}

/** Abre uma tela do site no navegador do aparelho. */
export function openSite(path: SitePath): Promise<true> {
  return Linking.openURL(siteUrl(path));
}

export const SITE_LINK_HINT = "Abre o site do Contaí no navegador.";
