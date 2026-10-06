// Durações, curvas e mola da seção 9.1 do design-system.md, no formato do Motion. É a única
// fonte para os componentes; os mesmos valores estão em globals.css para as transições de CSS.
import type { Transition, Variants } from "motion/react";

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

/** Barras de gráfico e de ranking: crescem uma vez. */
export const barTransition = {
  duration: duration.slow,
  ease: ease.out,
} as const satisfies Transition;

/**
 * Entrada do painel (seção 9.2): os cartões sobem 8px com opacidade, em cascata de 60ms. O
 * contêiner usa `cascade` e cada cartão, `cascadeItem`.
 */
export const cascade = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
} as const satisfies Variants;

export const cascadeItem = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
} as const satisfies Variants;
