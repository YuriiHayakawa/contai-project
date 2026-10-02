/**
 * Chave das consultas do painel. Fica fora dos hooks para as outras features poderem avisar que
 * os números mudaram sem carregar o painel junto.
 */
export const dashboardQueryKey = ["dashboard"] as const;
