// Escolha de tema: Claro, Escuro ou Automático (segue o sistema). O atributo `data-theme` do
// <html> é o que os tokens de globals.css leem. A chave e os valores são os mesmos de
// public/theme-init.js, que aplica o tema antes da primeira pintura.

export type ThemeChoice = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "contai-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Lê a escolha salva; sem escolha, ou com o armazenamento bloqueado, vale Automático. */
export function getThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "auto" ? systemTheme() : choice;
}

/** Aplica o tema ao documento, sem gravar. */
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Grava a escolha e aplica na hora. Automático apaga a chave. */
export function setThemeChoice(choice: ThemeChoice): ResolvedTheme {
  try {
    if (choice === "auto") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Sem armazenamento, a escolha vale só até recarregar a página.
  }
  return applyTheme(choice);
}

/**
 * Em Automático, acompanha a troca de tema do sistema enquanto o app está aberto. Devolve a
 * função que encerra o acompanhamento.
 */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onChange = (): void => {
    if (getThemeChoice() === "auto") applyTheme("auto");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
