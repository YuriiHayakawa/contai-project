// Fontes do design-system.md (seção 3): Besley nos títulos e Atkinson Hyperlegible Next no texto,
// na interface e nos números. Cada peso é um arquivo, e cada arquivo vira uma família no app.
import { AtkinsonHyperlegibleNext_400Regular } from "@expo-google-fonts/atkinson-hyperlegible-next/400Regular";
import { AtkinsonHyperlegibleNext_600SemiBold } from "@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold";
import { AtkinsonHyperlegibleNext_700Bold } from "@expo-google-fonts/atkinson-hyperlegible-next/700Bold";
import { AtkinsonHyperlegibleNext_800ExtraBold } from "@expo-google-fonts/atkinson-hyperlegible-next/800ExtraBold";
import { Besley_600SemiBold } from "@expo-google-fonts/besley/600SemiBold";
import { Besley_700Bold } from "@expo-google-fonts/besley/700Bold";
import { Besley_800ExtraBold } from "@expo-google-fonts/besley/800ExtraBold";
import { useFonts } from "expo-font";

import type { FontRole, FontWeight } from "./tokens";

const fontFiles = {
  AtkinsonHyperlegibleNext_400Regular,
  AtkinsonHyperlegibleNext_600SemiBold,
  AtkinsonHyperlegibleNext_700Bold,
  AtkinsonHyperlegibleNext_800ExtraBold,
  Besley_600SemiBold,
  Besley_700Bold,
  Besley_800ExtraBold,
};

type FontFamily = keyof typeof fontFiles;

const families: Record<FontRole, Record<FontWeight, FontFamily>> = {
  body: {
    "400": "AtkinsonHyperlegibleNext_400Regular",
    "600": "AtkinsonHyperlegibleNext_600SemiBold",
    "700": "AtkinsonHyperlegibleNext_700Bold",
    "800": "AtkinsonHyperlegibleNext_800ExtraBold",
  },
  // Besley só tem títulos: 600, 700 e 800. O 400 cai no 600, que é o mais leve usado.
  heading: {
    "400": "Besley_600SemiBold",
    "600": "Besley_600SemiBold",
    "700": "Besley_700Bold",
    "800": "Besley_800ExtraBold",
  },
};

/** O nome da família de um papel e um peso, para usar em `fontFamily`. */
export function fontFamily(role: FontRole, weight: FontWeight): string {
  return families[role][weight];
}

/** Carrega as fontes. Devolve `true` quando prontas, ou quando o carregamento falhou. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontFiles);
  // Sem as fontes, o app segue com as do sistema em vez de ficar preso na abertura.
  return loaded || error != null;
}
