// Paleta fechada de cores de categoria (seção 2.3 do design-system.md). O banco guarda o nome
// do token; não existe cor livre nem valor em hexadecimal.

/** As oito cores que o usuário pode escolher, na ordem validada para daltonismo. */
export const SELECTABLE_CATEGORY_COLORS = [
  "tinta",
  "caqui",
  "piscina",
  "mostarda",
  "goiaba",
  "mata",
  "ameixa",
  "pitanga",
] as const;

export type SelectableCategoryColor = (typeof SELECTABLE_CATEGORY_COLORS)[number];
/** `ardosia` é reservada à categoria "Outros" e ao agrupamento "Outras" dos gráficos. */
export type CategoryColor = SelectableCategoryColor | "ardosia";

/** Nome escrito ao lado de cada amostra: a cor nunca é o único sinal. */
export const CATEGORY_COLOR_LABELS: Record<CategoryColor, string> = {
  tinta: "Azul",
  caqui: "Laranja",
  piscina: "Verde-água",
  mostarda: "Mostarda",
  goiaba: "Rosa",
  mata: "Verde",
  ameixa: "Roxo",
  pitanga: "Vermelho",
  ardosia: "Neutro",
};

// Classes escritas por extenso para o Tailwind encontrá-las. A cor de categoria é sempre
// preenchimento, nunca cor de texto.
export const CATEGORY_FILL_CLASS: Record<CategoryColor, string> = {
  tinta: "bg-cat-tinta",
  caqui: "bg-cat-caqui",
  piscina: "bg-cat-piscina",
  mostarda: "bg-cat-mostarda",
  goiaba: "bg-cat-goiaba",
  mata: "bg-cat-mata",
  ameixa: "bg-cat-ameixa",
  pitanga: "bg-cat-pitanga",
  ardosia: "bg-cat-ardosia",
};

export function isCategoryColor(value: string): value is CategoryColor {
  return Object.hasOwn(CATEGORY_FILL_CLASS, value);
}
