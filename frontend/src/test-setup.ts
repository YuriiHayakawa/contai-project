import "@testing-library/jest-dom/vitest";

import { MotionGlobalConfig } from "motion/react";

// As animações do Motion terminam na hora: os testes conferem o resultado, não o movimento.
MotionGlobalConfig.skipAnimations = true;

// O jsdom não implementa matchMedia. O padrão dos testes é tela de celular, tema claro e sem
// preferência de movimento reduzido; um teste que precise de outra coisa substitui o stub.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}
