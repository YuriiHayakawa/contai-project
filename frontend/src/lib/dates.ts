// Datas no frontend. Uma data de lançamento é um dia de calendário (`YYYY-MM-DD`), sem hora e
// sem fuso; "hoje" é sempre o dia em America/Sao_Paulo, igual ao backend (Princípio VIII).

export const APP_TIME_ZONE = "America/Sao_Paulo";

/** Dia de calendário no formato `YYYY-MM-DD`. */
export type ISODate = string;
/** Mês de calendário no formato `YYYY-MM`. */
export type YearMonth = string;

const saoPauloParts = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// As datas de calendário são formatadas em UTC, a partir do meio-dia, para o dia nunca mudar.
const dayFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayWithYearFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const longMonthFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" });
const shortMonthFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short" });

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function calendarDate(iso: ISODate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError(`Data fora do formato YYYY-MM-DD: ${iso}`);
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

/** Converte um instante no dia de calendário em que ele cai em São Paulo. */
export function toISODate(instant: Date): ISODate {
  const parts = saoPauloParts.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** "Hoje" em São Paulo, mesmo que o aparelho esteja em outro fuso. */
export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Soma dias a uma data de calendário; aceita valores negativos. */
export function addDays(iso: ISODate, days: number): ISODate {
  const date = calendarDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * Rótulo do dia nas listas: "Hoje", "Ontem" ou "seg., 28 de set."; em outro ano, o ano entra
 * no fim ("seg., 28 de set. de 2025").
 */
export function dayLabel(iso: ISODate, reference: ISODate = today()): string {
  if (iso === reference) return "Hoje";
  if (iso === addDays(reference, -1)) return "Ontem";
  const sameYear = iso.slice(0, 4) === reference.slice(0, 4);
  return (sameYear ? dayFormat : dayWithYearFormat).format(calendarDate(iso));
}

/** Mês de uma data ou o mês atual em São Paulo, como `YYYY-MM`. */
export function yearMonthOf(iso: ISODate = today()): YearMonth {
  return iso.slice(0, 7);
}

/** Nome do mês: "outubro" (`long`) ou "out" (`short`, para eixos de gráfico). */
export function monthName(yearMonth: YearMonth, format: "long" | "short" = "long"): string {
  const date = calendarDate(`${yearMonth}-01`);
  if (format === "long") return longMonthFormat.format(date);
  return shortMonthFormat.format(date).replace(/\.$/, "");
}

/** Mês com ano, como no título do painel: "Outubro de 2026". */
export function monthLabel(yearMonth: YearMonth): string {
  const name = monthName(yearMonth);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${yearMonth.slice(0, 4)}`;
}

/** Soma meses a um mês de calendário; aceita valores negativos. */
export function addMonths(yearMonth: YearMonth, months: number): YearMonth {
  const date = calendarDate(`${yearMonth}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}`;
}

/** Primeiro e último dia de um mês, como os filtros de período esperam. */
export function monthRange(yearMonth: YearMonth): { from: ISODate; to: ISODate } {
  return { from: `${yearMonth}-01`, to: addDays(`${addMonths(yearMonth, 1)}-01`, -1) };
}

/**
 * Soma meses a uma data; em mês sem aquele dia, usa o último dia dele (31 de janeiro mais um
 * mês é 28 ou 29 de fevereiro). É a regra das parcelas no servidor.
 */
export function addMonthsToDate(iso: ISODate, months: number): ISODate {
  const day = Number(iso.slice(8, 10));
  const month = addMonths(yearMonthOf(iso), months);
  const lastDay = Number(monthRange(month).to.slice(8, 10));
  return `${month}-${pad(Math.min(day, lastDay), 2)}`;
}

const shortDayFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

/** Dia e mês curtos, como "3 de out.", para datas de fatura. */
export function shortDate(iso: ISODate): string {
  return shortDayFormat.format(calendarDate(iso));
}
