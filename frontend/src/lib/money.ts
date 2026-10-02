// Dinheiro no frontend: sempre inteiros em centavos (Princípio VIII). A formatação acontece só
// na exibição, e nenhuma conta passa por número de ponto flutuante.

const NBSP = " ";
const MINUS = "−";

/** Maior valor aceito pelo campo de dinheiro: R$ 999.999.999,99. */
export const MAX_AMOUNT_CENTS = 99_999_999_999;

const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export interface FormatBRLOptions {
  /**
   * `auto` mostra só o `−` dos negativos; `always` mostra também o `+` dos positivos (receita
   * em listas); `never` não mostra sinal.
   */
  sign?: "auto" | "always" | "never";
}

/** `123456` vira `1.234,56`: o valor sem o `R$`, como aparece no campo de dinheiro. */
export function formatCentsAsDecimal(cents: number): string {
  const absolute = Math.abs(Math.trunc(cents));
  const reais = Math.trunc(absolute / 100);
  const centavos = String(absolute % 100).padStart(2, "0");
  return `${integerFormat.format(reais)},${centavos}`;
}

/** `123456` vira `R$ 1.234,56`, com espaço não separável; negativo vira `−R$ 45,90`. */
export function formatBRL(cents: number, options: FormatBRLOptions = {}): string {
  const { sign = "auto" } = options;
  const value = `R$${NBSP}${formatCentsAsDecimal(cents)}`;
  if (sign === "never" || cents === 0) return value;
  if (cents < 0) return `${MINUS}${value}`;
  return sign === "always" ? `+${value}` : value;
}

/**
 * Converte um texto colado ou digitado em centavos. Aceita `1.234,56`, `1234.56`, `R$ 45,90` e
 * `1234`. O último separador seguido de um ou dois algarismos é o decimal; os outros são de
 * milhar. O sinal é descartado: o valor do campo é sempre positivo. Devolve `null` quando não
 * há algarismos ou o valor passa do limite.
 */
export function parseBRLToCents(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const lastSeparator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  const decimals = lastSeparator === -1 ? "" : cleaned.slice(lastSeparator + 1);
  const hasDecimals = decimals.length === 1 || decimals.length === 2;

  const reaisDigits = (hasDecimals ? cleaned.slice(0, lastSeparator) : cleaned).replace(/\D/g, "");
  const centavosDigits = hasDecimals ? decimals.padEnd(2, "0") : "00";

  // Cabe com folga em um inteiro seguro: o limite tem 11 algarismos.
  if (reaisDigits.replace(/^0+/, "").length > 9) return null;

  const cents = Number(reaisDigits || "0") * 100 + Number(centavosDigits);
  return cents > MAX_AMOUNT_CENTS ? null : cents;
}

/**
 * Digitação de caixa registradora: os algarismos entram pela direita. Recebe o texto do campo
 * depois da tecla e devolve o valor em centavos, lendo só os algarismos: com `0,45` na tela,
 * digitar `9` deixa `0,459`, que vale 459 centavos (`4,59`); apagar deixa `0,4`, que vale 4.
 * Funciona igual com teclado físico e virtual, porque não depende de qual tecla foi apertada.
 * Uma tecla que passaria do limite é ignorada: volta o valor anterior.
 */
export function centsFromTypedText(text: string, previous: number): number {
  const digits = text.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length > String(MAX_AMOUNT_CENTS).length) return previous;
  const cents = Number(digits || "0");
  return cents > MAX_AMOUNT_CENTS ? previous : cents;
}
