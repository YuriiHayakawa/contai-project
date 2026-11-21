// Prova do código compartilhado (T008, research seção 4): o app usa direto os arquivos puros do
// site pelo apelido `@web`. Se este teste quebrar, o código compartilhado deixou de funcionar.
import { formatBRL, parseBRLToCents } from "@web/lib/money";
import { APP_TIME_ZONE, today } from "@web/lib/dates";
import { transactionSchema } from "@web/features/transactions/schemas";

// O site separa "R$" do número com um espaço inseparável.
const NBSP = String.fromCharCode(0xa0);

describe("código do site no app", () => {
  it("formata e lê dinheiro como o site", () => {
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(parseBRLToCents("45,90")).toBe(4590);
  });

  it("usa o dia de Brasília perto da meia-noite", () => {
    expect(APP_TIME_ZONE).toBe("America/Sao_Paulo");
    // 02h30 em UTC do dia 2 ainda é 23h30 do dia 1 em Brasília.
    expect(today(new Date("2026-11-02T02:30:00Z"))).toBe("2026-11-01");
  });

  it("valida o lançamento com o schema do site", () => {
    const result = transactionSchema.safeParse({
      type: "expense",
      amountCents: 0,
      description: "",
      categoryId: "",
      accountId: "",
      installments: "1",
      fromAccountId: "",
      toAccountId: "",
      date: "2026-11-18",
      notes: "",
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Informe um valor maior que zero.");
    expect(messages).toContain("Escolha uma conta.");
  });
});
