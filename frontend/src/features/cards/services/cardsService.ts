// Chamadas HTTP da tela de cartões. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { YearMonth } from "../../../lib/dates";
import type { DashboardCategories } from "../../dashboard/types";
import type { CardInvoices } from "../types";

/** As faturas de um cartão, com o estado de cada uma, e o que pagar nele hoje. */
export function getCardInvoices(cardId: string, signal?: AbortSignal): Promise<CardInvoices> {
  return api.get<CardInvoices>(`/dashboard/cards/${cardId}/invoices`, { signal });
}

/** Gastos por categoria da fatura que fecha em `closingMonth`: só as compras do cartão. */
export function getInvoiceCategories(
  cardId: string,
  closingMonth: YearMonth,
  signal?: AbortSignal,
): Promise<DashboardCategories> {
  return api.get<DashboardCategories>(
    `/dashboard/cards/${cardId}/invoices/${closingMonth}/categories`,
    { signal },
  );
}
