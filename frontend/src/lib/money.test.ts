import {
  MAX_AMOUNT_CENTS,
  centsFromTypedText,
  formatBRL,
  formatCentsAsDecimal,
  formatCompactBRL,
  parseBRLToCents,
  splitInstallments,
} from "./money";

describe("formatBRL", () => {
  it("formata no padrão R$ 1.234,56 com espaço não separável", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(100000000)).toBe("R$ 1.000.000,00");
  });

  it("usa o sinal de menos tipográfico antes do R$", () => {
    expect(formatBRL(-4590)).toBe("−R$ 45,90");
    expect(formatBRL(-4590)).not.toContain("-");
  });

  it("mostra o + só quando pedido e nunca no zero", () => {
    expect(formatBRL(4590, { sign: "always" })).toBe("+R$ 45,90");
    expect(formatBRL(-4590, { sign: "always" })).toBe("−R$ 45,90");
    expect(formatBRL(0, { sign: "always" })).toBe("R$ 0,00");
    expect(formatBRL(-4590, { sign: "never" })).toBe("R$ 45,90");
  });

  it("não perde centavos em valores que o ponto flutuante arredonda", () => {
    expect(formatBRL(1005)).toBe("R$ 10,05");
    expect(formatBRL(MAX_AMOUNT_CENTS)).toBe("R$ 999.999.999,99");
  });
});

describe("formatCentsAsDecimal", () => {
  it("devolve o valor sem o símbolo", () => {
    expect(formatCentsAsDecimal(4590)).toBe("45,90");
    expect(formatCentsAsDecimal(123456)).toBe("1.234,56");
  });
});

describe("parseBRLToCents", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234.56", 123456],
    ["1,234.56", 123456],
    ["R$ 1.234,56", 123456],
    ["R$ 45,90", 4590],
    ["45,9", 4590],
    ["1234", 123400],
    ["1.234", 123400],
    ["1.234.567", 123456700],
    ["0,05", 5],
    [",5", 50],
    ["  12,00  ", 1200],
  ])("converte %j em %i centavos", (text, cents) => {
    expect(parseBRLToCents(text)).toBe(cents);
  });

  it("descarta o sinal: o valor do campo é sempre positivo", () => {
    expect(parseBRLToCents("-45,90")).toBe(4590);
    expect(parseBRLToCents("−R$ 45,90")).toBe(4590);
  });

  it("devolve null sem algarismos ou acima do limite", () => {
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("R$ ,")).toBeNull();
    expect(parseBRLToCents("1.000.000.000,00")).toBeNull();
    expect(parseBRLToCents("999.999.999,99")).toBe(MAX_AMOUNT_CENTS);
  });
});

describe("digitação pela direita", () => {
  /** Digita no fim do campo, que mostra o valor atual, e devolve o valor novo. */
  const type = (cents: number, key: string): number =>
    centsFromTypedText(`${formatCentsAsDecimal(cents)}${key}`, cents);
  /** Apaga o último caractere do campo. */
  const erase = (cents: number): number =>
    centsFromTypedText(formatCentsAsDecimal(cents).slice(0, -1), cents);

  it("digitar 4, 5, 9, 0 mostra 0,04, 0,45, 4,59 e 45,90", () => {
    const steps = ["4", "5", "9", "0"].reduce<number[]>(
      (values, key) => [...values, type(values.at(-1) ?? 0, key)],
      [],
    );

    expect(steps).toEqual([4, 45, 459, 4590]);
    expect(steps.map(formatCentsAsDecimal)).toEqual(["0,04", "0,45", "4,59", "45,90"]);
  });

  it("apagar remove o último algarismo", () => {
    expect(erase(4590)).toBe(459);
    expect(erase(123456)).toBe(12345);
    expect(erase(4)).toBe(0);
    expect(erase(0)).toBe(0);
  });

  it("ignora o que não é algarismo e a tecla que passaria do limite", () => {
    expect(type(45, "a")).toBe(45);
    expect(type(45, ",")).toBe(45);
    expect(type(MAX_AMOUNT_CENTS, "1")).toBe(MAX_AMOUNT_CENTS);
  });

  it("campo esvaziado vale zero", () => {
    expect(centsFromTypedText("", 4590)).toBe(0);
  });
});

describe("formatCompactBRL", () => {
  it("encurta valores redondos para o eixo de um gráfico", () => {
    expect(formatCompactBRL(0)).toBe("0");
    expect(formatCompactBRL(50_000)).toBe("R$ 500");
    expect(formatCompactBRL(200_000)).toBe("R$ 2 mil");
    expect(formatCompactBRL(250_000)).toBe("R$ 2,5 mil");
    expect(formatCompactBRL(1_500_000_00)).toBe("R$ 1,5 mi");
  });

  it("negativo leva o sinal de menos tipográfico", () => {
    expect(formatCompactBRL(-200_000)).toBe("−R$ 2 mil");
  });
});

describe("splitInstallments", () => {
  it.each([
    [10_000, 3, [3_334, 3_333, 3_333]],
    [10_000, 2, [5_000, 5_000]],
    [123_457, 48, [2_573, ...Array<number>(47).fill(2_572)]],
    [3, 3, [1, 1, 1]],
  ])("%i centavos em %i parcelas", (total, count, expected) => {
    const parts = splitInstallments(total, count);

    expect(parts).toEqual(expected);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
  });

  it("sem valor ou sem parcelas, não há prévia", () => {
    expect(splitInstallments(0, 3)).toEqual([]);
    expect(splitInstallments(100, 0)).toEqual([]);
  });
});
