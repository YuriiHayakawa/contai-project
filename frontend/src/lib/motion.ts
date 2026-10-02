// Durações, curvas e mola da seção 9.1 do design-system.md, no formato do Motion. É a única
// fonte para os componentes; os mesmos valores estão em globals.css para as transições de CSS.
import type { Transition } from "motion/react";

/** Durações em segundos, como o Motion espera. */
export const duration = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.36,
  emphasis: 0.52,
} as const;

type CubicBezier = [number, number, number, number];

export const ease = {
  /** Tudo que entra. */
  out: [0.16, 1, 0.3, 1],
  /** Tudo que sai. */
  in: [0.4, 0, 1, 1],
  /** O que se move na tela. */
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, CubicBezier>;

/** Folhas e diálogos: mola sem ricochete. */
export const sheetSpring = {
  type: "spring",
  visualDuration: duration.slow,
  bounce: 0,
} as const satisfies Transition;

/** Entradas: toasts, mensagens, itens de lista. */
export const enterTransition = {
  duration: duration.base,
  ease: ease.out,
} as const satisfies Transition;

/** Saídas: sempre rápidas. */
export const exitTransition = {
  duration: duration.fast,
  ease: ease.in,
} as const satisfies Transition;
