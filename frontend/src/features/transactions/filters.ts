// Filtros da lista de lançamentos, guardados no endereço da página. Ficam nele para um link
// (do painel ou de um aviso) abrir a lista já filtrada e para o "voltar" do navegador desfazer
// um filtro. Sem período no endereço, a lista mostra o mês atual.
import { monthRange, yearMonthOf, type ISODate, type YearMonth } from "../../lib/dates";
import type { EntryType, TransactionFilters } from "./types";

export const FILTER_PARAM = {
  search: "q",
  from: "de",
  to: "ate",
  period: "periodo",
  account: "conta",
  category: "categoria",
  type: "tipo",
} as const;

export type FilterParamName = (typeof FILTER_PARAM)[keyof typeof FILTER_PARAM];

/** Valor de `periodo` que pede a lista inteira, sem limite de datas. */
export const ALL_PERIOD_PARAM = "tudo";
export const SEARCH_MAX_LENGTH = 100;

/**
 * - `default`: nada no endereço; vale o mês atual.
 * - `all`: todo o período, pedido com `periodo=tudo`.
 * - `range`: datas no endereço, de um mês inteiro ou de um intervalo livre.
 */
export type PeriodKind = "default" | "all" | "range";

export interface TransactionListView {
  /** O que vai para a API, já com as datas do mês atual quando o período é o padrão. */
  filters: TransactionFilters;
  periodKind: PeriodKind;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function isEntryType(value: string | null): value is EntryType {
  return value === "expense" || value === "income";
}

/** Só um valor no formato esperado vira filtro; o resto do endereço é ignorado. */
export function readListView(
  params: URLSearchParams,
  currentMonth: YearMonth = yearMonthOf(),
): TransactionListView {
  const matching = (name: FilterParamName, pattern: RegExp): string | undefined => {
    const value = params.get(name);
    return value && pattern.test(value) ? value : undefined;
  };

  let from = matching(FILTER_PARAM.from, DATE_PATTERN);
  let to = matching(FILTER_PARAM.to, DATE_PATTERN);
  let periodKind: PeriodKind = "range";
  if (!from && !to) {
    if (params.get(FILTER_PARAM.period) === ALL_PERIOD_PARAM) {
      periodKind = "all";
    } else {
      periodKind = "default";
      ({ from, to } = monthRange(currentMonth));
    }
  }

  const type = params.get(FILTER_PARAM.type);
  return {
    periodKind,
    filters: {
      q: params.get(FILTER_PARAM.search)?.trim().slice(0, SEARCH_MAX_LENGTH) || undefined,
      from,
      to,
      account_id: matching(FILTER_PARAM.account, ID_PATTERN),
      category_id: matching(FILTER_PARAM.category, ID_PATTERN),
      type: isEntryType(type) ? type : undefined,
    },
  };
}

/** O mês inteiro que o intervalo cobre, ou `null` quando ele não é exatamente um mês. */
export function wholeMonthOf(from: ISODate | undefined, to: ISODate | undefined): YearMonth | null {
  if (!from || !to) return null;
  const month = yearMonthOf(from);
  const range = monthRange(month);
  return range.from === from && range.to === to ? month : null;
}

/** Uma data aparece na lista quando cai dentro do período exibido. */
export function isDateShown(date: ISODate, filters: TransactionFilters): boolean {
  return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}

/** Parâmetros do endereço que abrem a lista em um mês; o mês atual não precisa de nenhum. */
export function monthSearch(month: YearMonth, currentMonth: YearMonth = yearMonthOf()): string {
  if (month === currentMonth) return "";
  const range = monthRange(month);
  const params = new URLSearchParams({
    [FILTER_PARAM.from]: range.from,
    [FILTER_PARAM.to]: range.to,
  });
  return `?${params.toString()}`;
}
