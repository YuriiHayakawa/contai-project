// Tokens do design-system.md (seções 2 a 5 e 9), nos temas claro (Papel) e escuro (Noite). São
// cópia dos valores do site, e não importação: o site os guarda em CSS (research, seção 11).
// Componentes usam o token, nunca o valor em hexadecimal.

export interface ColorTokens {
  bg: string;
  bgSunken: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  primarySoft: string;
  highlight: string;
  marginLine: string;
  scrim: string;
  income: string;
  incomeSoft: string;
  expense: string;
  expenseSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  onDanger: string;
}

export const lightColors: ColorTokens = {
  bg: "#F5F0E6",
  bgSunken: "#ECE5D6",
  surface: "#FFFDF8",
  surfaceRaised: "#FFFFFF",
  border: "#DDD3C0",
  borderStrong: "#877E6C",
  ink: "#1A2238",
  inkMuted: "#525C75",
  inkSubtle: "#586077",
  primary: "#2A3FB0",
  primaryHover: "#22348F",
  onPrimary: "#FFFFFF",
  primarySoft: "#E4E8FA",
  highlight: "#FFE066",
  marginLine: "#E3A996",
  scrim: "rgba(26, 34, 56, 0.5)",
  income: "#136F58",
  incomeSoft: "#D9F0E8",
  expense: "#AD4328",
  expenseSoft: "#F8E3DB",
  warning: "#8A5300",
  warningSoft: "#FCEFC9",
  danger: "#B4232F",
  dangerSoft: "#FADFE1",
  onDanger: "#FFFFFF",
};

export const darkColors: ColorTokens = {
  bg: "#10152A",
  bgSunken: "#0B0F20",
  surface: "#182040",
  surfaceRaised: "#202A52",
  border: "#2C3763",
  borderStrong: "#7C87B5",
  ink: "#EFE9DC",
  inkMuted: "#B3B9D1",
  inkSubtle: "#969DBC",
  primary: "#9DAEFF",
  primaryHover: "#B4C1FF",
  onPrimary: "#10152A",
  primarySoft: "#263161",
  highlight: "#5E4B00",
  marginLine: "#6B3A2C",
  scrim: "rgba(5, 8, 18, 0.65)",
  income: "#6FD3B0",
  incomeSoft: "#123A30",
  expense: "#F0977C",
  expenseSoft: "#4A2219",
  warning: "#F2C14E",
  warningSoft: "#45360B",
  danger: "#FF8F96",
  dangerSoft: "#4D1A20",
  onDanger: "#2A0A0E",
};

/** Base de 4 pt (seção 4). Entre itens de um grupo, 8 ou 12; entre grupos, 24; entre seções, 32. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
} as const;

/** Raios (seção 5). */
export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Área de toque mínima (seção 4). */
export const TOUCH_TARGET = 44;
/** Altura padrão de botões e campos (seções 6.1 e 6.2). */
export const CONTROL_HEIGHT = 48;

export type FontRole = "heading" | "body";
export type FontWeight = "400" | "600" | "700" | "800";

export interface TextStyleToken {
  role: FontRole;
  weight: FontWeight;
  fontSize: number;
  lineHeight: number;
  /** Algarismos tabulares, para valores em reais (seção 3.2). */
  tabular?: boolean;
}

/** Escala de texto (seções 3.1 e 3.2), em pontos. Acompanha o tamanho de fonte do sistema. */
export const textStyles = {
  display: { role: "heading", weight: "700", fontSize: 32, lineHeight: 38 },
  title1: { role: "heading", weight: "700", fontSize: 24, lineHeight: 30 },
  title2: { role: "heading", weight: "600", fontSize: 20, lineHeight: 26 },
  title3: { role: "body", weight: "700", fontSize: 17, lineHeight: 24 },
  body: { role: "body", weight: "400", fontSize: 16, lineHeight: 24 },
  bodyStrong: { role: "body", weight: "700", fontSize: 16, lineHeight: 24 },
  label: { role: "body", weight: "600", fontSize: 14, lineHeight: 20 },
  small: { role: "body", weight: "400", fontSize: 14, lineHeight: 20 },
  micro: { role: "body", weight: "600", fontSize: 12, lineHeight: 16 },
  moneyHero: { role: "body", weight: "800", fontSize: 40, lineHeight: 44, tabular: true },
  moneyLg: { role: "body", weight: "700", fontSize: 24, lineHeight: 30, tabular: true },
  moneyMd: { role: "body", weight: "700", fontSize: 16, lineHeight: 24, tabular: true },
  moneySm: { role: "body", weight: "600", fontSize: 14, lineHeight: 20, tabular: true },
} as const satisfies Record<string, TextStyleToken>;

export type TextVariant = keyof typeof textStyles;

/** Durações de animação (seção 9.1), em milissegundos. */
export const duration = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 360,
} as const;
