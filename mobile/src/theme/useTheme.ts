import { useColorScheme } from "react-native";

import { type ColorTokens, darkColors, lightColors } from "./tokens";

export interface Theme {
  scheme: "light" | "dark";
  colors: ColorTokens;
}

const light: Theme = { scheme: "light", colors: lightColors };
const dark: Theme = { scheme: "dark", colors: darkColors };

/** O tema segue o do sistema e muda na hora em que o usuário troca (design-system, seção 2). */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
