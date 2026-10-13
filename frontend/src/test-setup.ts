import "@testing-library/jest-dom/vitest";

import { configure } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";

import { resetAuthSession } from "./lib/api-client";

// As animações do Motion terminam na hora: os testes conferem o resultado, não o movimento.
MotionGlobalConfig.skipAnimations = true;

// O app divide cada tela em um `import()` próprio (React.lazy). Rodando os arquivos de teste em
// paralelo, cada processo paga o custo desse carregamento sob disputa de CPU, e o padrão de 1s
// do `findBy`/`waitFor` fica curto para a primeira pintura de uma rota — não por erro, só por
// tempo. Uma margem maior absorve essa variação sem mexer no paralelismo nem repetir testes.
configure({ asyncUtilTimeout: 5000 });

// Isolamento entre testes, inclusive entre arquivos que dividem o mesmo processo do Vitest: cada
// teste começa com relógio real, sem `fetch` falso de outro teste e com a sessão em memória
// zerada. Sem isto, um refresh silencioso deixado em andamento por um teste podia responder no
// meio do teste seguinte e trocar a sessão, derrubando testes de forma intermitente.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAuthSession();
});

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
