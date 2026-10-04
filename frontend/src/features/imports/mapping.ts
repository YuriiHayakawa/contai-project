// Leitura das primeiras linhas de um CSV ou planilha com o modelo de colunas escolhido, para a
// prévia do mapeamento (FR-039). Segue as regras do servidor
// (backend/app/modules/imports/importers/tabular.py): a prévia mostra o que será importado.
import type { ISODate } from "../../lib/dates";
import type { ColumnMapping, DateFormat, DecimalSeparator } from "./types";

/** O que foi lido de uma célula: um valor, nada (célula sem data ou sem valor) ou ilegível. */
export type Reading<T> =
  { status: "value"; value: T } | { status: "empty" } | { status: "unreadable" };

export interface InterpretedRow {
  date: Reading<ISODate>;
  description: string;
  /** Em centavos, com sinal: negativo é o que sai da conta. */
  amountCents: Reading<number>;
}

const EMPTY = { status: "empty" } as const;
const UNREADABLE = { status: "unreadable" } as const;

const DATE = /(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/;
const COMPACT_DATE = /^\d{8}$/;
const HAS_DIGIT = /\d/;
const DEBIT_SUFFIX = /\bD\s*$/i;
const PLAIN_NUMBER = /^\d*(\.\d*)?$/;

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** A data de uma célula, com o dia, o mês e o ano na ordem escolhida. */
export function readDate(cell: string, format: DateFormat): Reading<ISODate> {
  if (!HAS_DIGIT.test(cell)) return EMPTY;
  const text = cell.trim();
  const match = DATE.exec(text);
  let parts: [string, string, string];
  if (match?.[1] && match[2] && match[3]) {
    parts = [match[1], match[2], match[3]];
  } else if (COMPACT_DATE.test(text)) {
    parts =
      format === "ymd"
        ? [text.slice(0, 4), text.slice(4, 6), text.slice(6)]
        : [text.slice(0, 2), text.slice(2, 4), text.slice(4)];
  } else {
    return UNREADABLE;
  }

  const [first, second, third] = parts;
  let order: [string, string, string];
  // Um ano de quatro algarismos na frente não deixa dúvida, seja qual for o formato escolhido.
  if (first.length === 4 || format === "ymd") order = [first, second, third];
  else if (format === "mdy") order = [third, first, second];
  else order = [third, second, first];

  const year = Number(order[0]) + (order[0].length <= 2 ? 2000 : 0);
  const month = Number(order[1]);
  const day = Number(order[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const exists =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!exists || year < 1) return UNREADABLE;
  return { status: "value", value: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` };
}

/**
 * O valor de uma célula em centavos, com sinal. Aceita `R$ 1.234,56`, `-45,90`, `45,90-`,
 * `(45,90)` e `45,90 D`. Sem ponto flutuante: os centavos saem do próprio texto.
 */
export function readAmountCents(cell: string, decimalSeparator: DecimalSeparator): Reading<number> {
  const text = cell.replace("R$", "").trim();
  if (!HAS_DIGIT.test(text)) return EMPTY;
  const negative = /^[-−(]/.test(text) || text.endsWith("-") || DEBIT_SUFFIX.test(text);
  const digits = text.replace(/[^\d.,]/g, "");
  const thousands = decimalSeparator === "," ? "." : ",";

  // `45.90` com a vírgula como decimal: o ponto ali não separa milhares, e o valor não é 4590.
  const [integerPart = ""] = digits.split(decimalSeparator);
  const groups = integerPart.split(thousands);
  if (groups.slice(1).some((group) => group.length !== 3)) return UNREADABLE;

  const plain = digits.replaceAll(thousands, "").replace(",", ".");
  if (!PLAIN_NUMBER.test(plain)) return UNREADABLE;
  const [whole = "", fraction = ""] = plain.split(".");
  let cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  if (Number(fraction.charAt(2) || "0") >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return UNREADABLE;
  return { status: "value", value: negative ? -cents : cents };
}

function unsigned(cell: string | undefined, decimalSeparator: DecimalSeparator): Reading<number> {
  const reading = readAmountCents(cell ?? "", decimalSeparator);
  if (reading.status === "empty") return { status: "value", value: 0 };
  if (reading.status === "unreadable") return reading;
  return { status: "value", value: Math.abs(reading.value) };
}

/** Uma linha do arquivo lida com o modelo de colunas: data, descrição e valor com sinal. */
export function interpretRow(row: readonly string[], mapping: ColumnMapping): InterpretedRow {
  const date = readDate(row[mapping.date_column] ?? "", mapping.date_format);
  const description = (row[mapping.description_column] ?? "").trim();

  let amountCents: Reading<number>;
  if (mapping.amount_column !== null) {
    amountCents = readAmountCents(row[mapping.amount_column] ?? "", mapping.decimal_separator);
    if (amountCents.status === "value" && mapping.sign_convention === "positive_is_expense") {
      amountCents = { status: "value", value: -amountCents.value };
    }
  } else {
    // Colunas separadas: o sinal dentro delas não importa, só em qual o valor está.
    const income = unsigned(row[mapping.income_column ?? -1], mapping.decimal_separator);
    const expense = unsigned(row[mapping.expense_column ?? -1], mapping.decimal_separator);
    if (income.status !== "value" || expense.status !== "value") amountCents = UNREADABLE;
    else amountCents = { status: "value", value: income.value - expense.value };
  }
  // Linha sem valor não vira lançamento.
  if (amountCents.status === "value" && amountCents.value === 0) amountCents = EMPTY;

  return { date, description, amountCents };
}
