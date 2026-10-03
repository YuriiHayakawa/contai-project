import { formatBRL } from "../../lib/money";

/** O que se diz das saídas de um mês em que os estornos passaram do que foi gasto. */
export const REFUNDS_IN_FAVOR = "a seu favor, de estornos";

/**
 * As saídas de um mês, por escrito. Quando os estornos passam do que foi gasto, o total fica
 * negativo: em vez do sinal de menos, que pareceria um gasto, o valor aparece como dinheiro a
 * favor do usuário. A conta não muda, só o jeito de dizer.
 */
export function spendingText(cents: number): string {
  return cents < 0 ? `${formatBRL(-cents)} ${REFUNDS_IN_FAVOR}` : formatBRL(cents);
}
