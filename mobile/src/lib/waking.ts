// "Acordando o servidor…": a API dorme depois de um tempo sem acessos e leva cerca de um minuto
// para acordar (ADR 0010). Uma requisição que passa de 4 s sem resposta liga o aviso, que fica
// ligado enquanto houver alguma assim (research, seção 5).
import { useSyncExternalStore } from "react";

export const WAKING_DELAY_MS = 4_000;
export const WAKING_MESSAGE = "Acordando o servidor… Pode levar até um minuto.";

let slowRequests = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Marca o início de uma requisição. Devolve a função que marca o fim. */
export function trackRequest(): () => void {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    slowRequests += 1;
    emit();
  }, WAKING_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (slow) {
      slow = false;
      slowRequests -= 1;
      emit();
    }
  };
}

export function isWaking(): boolean {
  return slowRequests > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Se o aviso está ligado. A tela muda sozinha quando ele liga ou desliga. */
export function useWaking(): boolean {
  return useSyncExternalStore(subscribe, isWaking, isWaking);
}

/** Testes: desliga o aviso entre um teste e outro. */
export function resetWaking(): void {
  slowRequests = 0;
  emit();
}
