import {
  addDays,
  addMonths,
  addMonthsToDate,
  dateTimeLabel,
  dayLabel,
  monthLabel,
  monthName,
  monthRange,
  toISODate,
  today,
  yearMonthOf,
} from "./dates";

describe("today e toISODate", () => {
  it("usa o dia de São Paulo, e não o do UTC", () => {
    // 02:30 UTC de 2 de outubro ainda é 23:30 de 1º de outubro em São Paulo.
    expect(today(new Date("2026-10-02T02:30:00Z"))).toBe("2026-10-01");
    expect(today(new Date("2026-10-02T03:00:00Z"))).toBe("2026-10-02");
  });

  it("converte um instante para YYYY-MM-DD com zeros à esquerda", () => {
    expect(toISODate(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
    expect(toISODate(new Date("2027-01-01T01:00:00Z"))).toBe("2026-12-31");
  });

  it("sem argumento, usa o relógio do sistema", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    expect(today()).toBe("2026-03-15");
    vi.useRealTimers();
  });
});

describe("addDays", () => {
  it("atravessa meses e anos", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("recusa texto fora do formato", () => {
    expect(() => addDays("01/10/2026", 1)).toThrow(RangeError);
  });
});

describe("dayLabel", () => {
  const reference = "2026-10-01";

  it('mostra "Hoje" e "Ontem"', () => {
    expect(dayLabel("2026-10-01", reference)).toBe("Hoje");
    expect(dayLabel("2026-09-30", reference)).toBe("Ontem");
  });

  it("mostra o dia da semana, o dia e o mês abreviados", () => {
    expect(dayLabel("2026-09-28", reference)).toBe("seg., 28 de set.");
    expect(dayLabel("2026-10-03", reference)).toBe("sáb., 3 de out.");
  });

  it("inclui o ano quando ele é outro", () => {
    expect(dayLabel("2025-09-28", reference)).toBe("dom., 28 de set. de 2025");
  });

  it('considera "Ontem" na virada do ano', () => {
    expect(dayLabel("2025-12-31", "2026-01-01")).toBe("Ontem");
  });
});

describe("meses", () => {
  it("dá o nome do mês por extenso e abreviado", () => {
    expect(monthName("2026-10")).toBe("outubro");
    expect(monthName("2026-05", "short")).toBe("mai");
    expect(monthName("2026-09", "short")).toBe("set");
  });

  it("monta o rótulo com o ano", () => {
    expect(monthLabel("2026-10")).toBe("Outubro de 2026");
    expect(monthLabel("2027-03")).toBe("Março de 2027");
  });

  it("extrai o mês de uma data", () => {
    expect(yearMonthOf("2026-10-01")).toBe("2026-10");
  });
});

describe("addMonths e monthRange", () => {
  it("soma e subtrai meses atravessando o ano", () => {
    expect(addMonths("2026-10", 1)).toBe("2026-11");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -11)).toBe("2025-11");
  });

  it("dá o primeiro e o último dia do mês, com fevereiro bissexto", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("addMonthsToDate", () => {
  it("cai no último dia de um mês mais curto e volta ao dia original depois", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDate("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsToDate("2026-10-20", 0)).toBe("2026-10-20");
  });
});

describe("dateTimeLabel", () => {
  it("mostra o dia e a hora de São Paulo, e não os do UTC", () => {
    expect(dateTimeLabel("2026-10-10T21:30:00Z")).toBe("10 de out. às 18:30");
    // 01:15 UTC do dia 11 ainda é 22:15 do dia 10 em São Paulo.
    expect(dateTimeLabel(new Date("2026-10-11T01:15:00Z"))).toBe("10 de out. às 22:15");
  });
});
