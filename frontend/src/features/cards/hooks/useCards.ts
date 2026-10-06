import { skipToken, useQuery } from "@tanstack/react-query";

import { yearMonthOf, type YearMonth } from "../../../lib/dates";
import { cardsQuery } from "../../dashboard/hooks/useDashboard";
import { dashboardQueryKey } from "../../dashboard/query-key";
import { getCardInvoices, getInvoiceCategories } from "../services/cardsService";

// As consultas ficam debaixo da chave do painel: um lançamento novo, editado ou excluído já
// avisa que os números do painel mudaram, e as faturas mudam junto.

/** Os cartões ativos, vistos de hoje: fatura atual, parcelas futuras e o que pagar. */
export function useCards() {
  return useQuery({ ...cardsQuery(yearMonthOf()), staleTime: 0 });
}

/** As faturas de um cartão, da mais antiga para a mais nova; sem cartão, não consulta. */
export function useCardInvoices(cardId: string | undefined) {
  return useQuery({
    queryKey: [...dashboardQueryKey, "card-invoices", cardId],
    queryFn: cardId ? ({ signal }) => getCardInvoices(cardId, signal) : skipToken,
    staleTime: 0,
  });
}

/** Gastos por categoria de uma fatura, identificada pelo mês em que fecha. */
export function useInvoiceCategories(
  cardId: string | undefined,
  closingMonth: YearMonth | undefined,
) {
  return useQuery({
    queryKey: [...dashboardQueryKey, "invoice-categories", cardId, closingMonth],
    queryFn:
      cardId && closingMonth
        ? ({ signal }) => getInvoiceCategories(cardId, closingMonth, signal)
        : skipToken,
  });
}
