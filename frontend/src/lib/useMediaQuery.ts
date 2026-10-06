import { useCallback, useSyncExternalStore } from "react";

/** Pontos de quebra do Tailwind usados em decisões que o CSS sozinho não resolve. */
export const breakpoints = {
  md: "(min-width: 768px)",
  lg: "(min-width: 1024px)",
} as const;

/** Acompanha uma media query; atualiza quando a janela muda de tamanho. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
