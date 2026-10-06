import { interpretRow, readAmountCents, readDate } from "./mapping";
import type { ColumnMapping } from "./types";

const value = <T>(result: T) => ({ status: "value", value: result });

describe("readDate", () => {
  it("lê dia, mês e ano na ordem escolhida", () => {
    expect(readDate("05/09/2026", "dmy")).toEqual(value("2026-09-05"));
    expect(readDate("09/05/2026", "mdy")).toEqual(value("2026-09-05"));
    expect(readDate("2026-09-05", "ymd")).toEqual(value("2026-09-05"));
    expect(readDate("05.09.26", "dmy")).toEqual(value("2026-09-05"));
    expect(readDate("20260905", "ymd")).toEqual(value("2026-09-05"));
  });

  it("ano de quatro algarismos na frente vale em qualquer formato", () => {
    expect(readDate("2026-09-12", "dmy")).toEqual(value("2026-09-12"));
  });

  it("célula sem números é vazia; data que não existe no formato é ilegível", () => {
    expect(readDate("", "dmy")).toEqual({ status: "empty" });
    expect(readDate("Saldo final", "dmy")).toEqual({ status: "empty" });
    expect(readDate("09/15/2026", "dmy")).toEqual({ status: "unreadable" });
    expect(readDate("000123", "dmy")).toEqual({ status: "unreadable" });
  });
});

describe("readAmountCents", () => {
  it("lê os formatos de valor dos extratos, com sinal", () => {
    expect(readAmountCents("R$ 5.450,00", ",")).toEqual(value(545_000));
    expect(readAmountCents("-45,90", ",")).toEqual(value(-4_590));
    expect(readAmountCents("45,90-", ",")).toEqual(value(-4_590));
    expect(readAmountCents("(45,90)", ",")).toEqual(value(-4_590));
    expect(readAmountCents("45,90 D", ",")).toEqual(value(-4_590));
    expect(readAmountCents("1,234.56", ".")).toEqual(value(123_456));
    expect(readAmountCents("210", ".")).toEqual(value(21_000));
    expect(readAmountCents("7.5", ".")).toEqual(value(750));
  });

  it("separador decimal errado é ilegível, e não um valor cem vezes maior", () => {
    expect(readAmountCents("59.90", ",")).toEqual({ status: "unreadable" });
    expect(readAmountCents("45,90", ".")).toEqual({ status: "unreadable" });
  });

  it("célula sem números é vazia", () => {
    expect(readAmountCents("", ",")).toEqual({ status: "empty" });
    expect(readAmountCents("R$", ",")).toEqual({ status: "empty" });
  });
});

describe("interpretRow", () => {
  const single: ColumnMapping = {
    date_column: 0,
    description_column: 1,
    amount_column: 3,
    income_column: null,
    expense_column: null,
    date_format: "dmy",
    decimal_separator: ",",
    sign_convention: "negative_is_expense",
  };

  it("uma coluna de valor: o negativo sai da conta", () => {
    const row = ["10/09/2026", " PADARIA SÃO JOÃO ", "000124", "-45,90", "5.904,10"];

    expect(interpretRow(row, single)).toEqual({
      date: value("2026-09-10"),
      description: "PADARIA SÃO JOÃO",
      amountCents: value(-4_590),
    });
  });

  it("fatura de cartão: o valor positivo é o gasto", () => {
    const card: ColumnMapping = {
      ...single,
      amount_column: 2,
      date_format: "ymd",
      decimal_separator: ".",
      sign_convention: "positive_is_expense",
    };

    expect(interpretRow(["2026-09-21", "Posto Estrela", "210.00"], card).amountCents).toEqual(
      value(-21_000),
    );
    expect(interpretRow(["2026-09-25", "Estorno Livraria", "-59.90"], card).amountCents).toEqual(
      value(5_990),
    );
  });

  it("colunas de entrada e saída: vale em qual coluna o valor está", () => {
    const split: ColumnMapping = {
      ...single,
      amount_column: null,
      income_column: 2,
      expense_column: 3,
    };

    expect(interpretRow(["05/09/26", "Salário", "R$ 5.450,00", ""], split).amountCents).toEqual(
      value(545_000),
    );
    expect(interpretRow(["10/09/26", "Padaria", "", "R$ 45,90"], split).amountCents).toEqual(
      value(-4_590),
    );
  });

  it("linha de total, sem data nem valor, não vira lançamento", () => {
    const total = interpretRow(["", "Saldo final", "", "", "4.514,73"], single);

    expect(total.date).toEqual({ status: "empty" });
    expect(total.amountCents).toEqual({ status: "empty" });
  });
});
