import { isDateShown, monthSearch, readListView, wholeMonthOf } from "./filters";

const OCTOBER = "2026-10";
const ACCOUNT = "9aed6bd1-1c77-42d3-8a4c-5d638f8465f5";

const view = (search: string) => readListView(new URLSearchParams(search), OCTOBER);

describe("readListView", () => {
  it("sem período no endereço, mostra o mês atual", () => {
    expect(view("")).toEqual({
      periodKind: "default",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
  });

  it("periodo=tudo tira o limite de datas", () => {
    expect(view("periodo=tudo")).toEqual({ periodKind: "all", filters: {} });
  });

  it("datas no endereço valem mais que o padrão e que periodo=tudo", () => {
    expect(view("de=2026-08-01&ate=2026-08-31&periodo=tudo")).toEqual({
      periodKind: "range",
      filters: { from: "2026-08-01", to: "2026-08-31" },
    });
    expect(view("de=2026-08-15").filters).toEqual({ from: "2026-08-15" });
  });

  it("lê busca, conta, categoria e tipo junto com o mês padrão", () => {
    expect(view(`q=%20padaria%20&conta=${ACCOUNT}&categoria=${ACCOUNT}&tipo=income`)).toEqual({
      periodKind: "default",
      filters: {
        q: "padaria",
        from: "2026-10-01",
        to: "2026-10-31",
        account_id: ACCOUNT,
        category_id: ACCOUNT,
        type: "income",
      },
    });
  });

  it("ignora valores fora do formato", () => {
    expect(view("de=ontem&ate=31/10/2026&conta=1&tipo=transfer&periodo=sempre")).toEqual({
      periodKind: "default",
      filters: { from: "2026-10-01", to: "2026-10-31" },
    });
  });
});

describe("wholeMonthOf", () => {
  it("reconhece um mês inteiro, inclusive fevereiro", () => {
    expect(wholeMonthOf("2026-08-01", "2026-08-31")).toBe("2026-08");
    expect(wholeMonthOf("2028-02-01", "2028-02-29")).toBe("2028-02");
  });

  it("não reconhece um intervalo livre nem um intervalo aberto", () => {
    expect(wholeMonthOf("2026-08-01", "2026-08-30")).toBeNull();
    expect(wholeMonthOf("2026-08-01", "2026-09-30")).toBeNull();
    expect(wholeMonthOf("2026-08-01", undefined)).toBeNull();
  });
});

describe("isDateShown", () => {
  it("inclui o primeiro e o último dia do período", () => {
    const { filters } = view("");

    expect(isDateShown("2026-10-01", filters)).toBe(true);
    expect(isDateShown("2026-10-31", filters)).toBe(true);
    expect(isDateShown("2026-09-30", filters)).toBe(false);
    expect(isDateShown("2026-11-01", filters)).toBe(false);
  });

  it("em todo o período, qualquer data aparece", () => {
    expect(isDateShown("2019-01-01", view("periodo=tudo").filters)).toBe(true);
  });
});

describe("monthSearch", () => {
  it("monta o endereço de um mês; o mês atual não precisa de parâmetros", () => {
    expect(monthSearch("2026-08", OCTOBER)).toBe("?de=2026-08-01&ate=2026-08-31");
    expect(monthSearch(OCTOBER, OCTOBER)).toBe("");
  });
});
