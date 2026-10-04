import { act, renderHook } from "@testing-library/react";

import type { Category, CategoryTree } from "../../categories/types";
import type { BalanceCheck, ImportItem } from "../types";
import { reviewBalanceCents, useImportReview } from "./useImportReview";

function category(id: string, name: string, kind: Category["kind"]): Category {
  return {
    id,
    name,
    kind,
    parent_id: null,
    icon: "shapes",
    color: "ardosia",
    is_fallback: false,
    archived: false,
    children: [],
  };
}

const categories: CategoryTree = {
  expense: [
    category("cat-mercado", "Mercado", "expense"),
    category("cat-livros", "Livros", "expense"),
  ],
  income: [category("cat-salario", "Salário", "income")],
};

function item(id: string, overrides: Partial<ImportItem> = {}): ImportItem {
  return {
    id,
    row_index: 0,
    type: "expense",
    transfer_direction: null,
    amount_cents: 4_590,
    date: "2026-09-10",
    description: "PADARIA SÃO JOÃO",
    suggested_category_id: "cat-mercado",
    category_source: "ai",
    suggested_counter_account_id: null,
    duplicate_status: "none",
    duplicate_of_id: null,
    selected_by_default: true,
    warning_code: null,
    warning_message: null,
    ...overrides,
  };
}

const salary = item("salario", {
  row_index: 0,
  type: "income",
  amount_cents: 545_000,
  date: "2026-09-05",
  description: "SALÁRIO EMPRESA FICTÍCIA LTDA",
  suggested_category_id: "cat-salario",
});
const bakery = item("padaria", { row_index: 1 });
const alreadyImported = item("mercado", {
  row_index: 2,
  amount_cents: 18_937,
  date: "2026-09-15",
  description: "SUPERMERCADO BOM PREÇO",
  duplicate_status: "exact",
  duplicate_of_id: "tx-1",
  selected_by_default: false,
});
const probable = item("tarifa", {
  row_index: 3,
  amount_cents: 1_200,
  date: "2026-09-15",
  description: "TARIFA PACOTE DE SERVIÇOS",
  duplicate_status: "probable",
  duplicate_of_id: "tx-2",
  selected_by_default: false,
});
const invoicePayment = item("fatura", {
  row_index: 4,
  type: "transfer",
  transfer_direction: "out",
  amount_cents: 80_000,
  date: "2026-09-20",
  description: "PAGAMENTO FATURA CARTÃO",
  suggested_category_id: null,
  category_source: null,
  suggested_counter_account_id: "acc-cartao",
});

const items = [salary, bakery, alreadyImported, probable, invoicePayment];

const renderReview = (lines: ImportItem[] = items) =>
  renderHook(() => useImportReview(lines, categories));

const selectedIds = (lines: { item: ImportItem; selected: boolean }[]): string[] =>
  lines.filter((line) => line.selected).map((line) => line.item.id);

describe("useImportReview: linhas marcadas", () => {
  it("duplicatas chegam desmarcadas; as outras linhas, marcadas", () => {
    const { result } = renderReview();

    expect(selectedIds(result.current.lines)).toEqual(["salario", "padaria", "fatura"]);
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.allSelected).toBe(false);
  });

  it("marca e desmarca uma linha, sem mexer nas outras", () => {
    const { result } = renderReview();

    act(() => result.current.toggle("padaria"));
    expect(selectedIds(result.current.lines)).toEqual(["salario", "fatura"]);

    act(() => result.current.toggle("padaria"));
    act(() => result.current.toggle("mercado"));
    expect(selectedIds(result.current.lines)).toEqual(["salario", "padaria", "mercado", "fatura"]);
  });

  it("marca todas, inclusive as duplicatas, e desmarca todas", () => {
    const { result } = renderReview();

    act(() => result.current.toggleAll(true));
    expect(result.current.selectedCount).toBe(5);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.toggleAll(false));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.allSelected).toBe(false);
  });
});

describe("useImportReview: correções", () => {
  it("edita valor, data, descrição e categoria de uma linha só", () => {
    const { result } = renderReview();

    act(() =>
      result.current.edit("padaria", {
        amountCents: 4_950,
        date: "2026-09-11",
        description: "Padaria São João",
        categoryId: "cat-livros",
      }),
    );

    const [first, edited] = result.current.lines;
    expect(edited).toMatchObject({
      kind: "expense",
      amountCents: 4_950,
      date: "2026-09-11",
      description: "Padaria São João",
      categoryId: "cat-livros",
      selected: true,
    });
    // A proposta original continua guardada, e as outras linhas não mudam.
    expect(edited?.item).toBe(bakery);
    expect(first).toMatchObject({ amountCents: 545_000, categoryId: "cat-salario" });
  });

  it("entrada sugerida em categoria de despesa chega como estorno", () => {
    const refund = item("estorno", {
      type: "income",
      amount_cents: 5_990,
      description: "Estorno Livraria Letras & Cia",
      suggested_category_id: "cat-livros",
      category_source: "user_rule",
    });
    const { result } = renderReview([refund, salary]);

    expect(result.current.lines.map((line) => line.kind)).toEqual(["refund", "income"]);
    // O estorno vai como receita na categoria de despesa da compra (FR-084).
    expect(result.current.confirmItems()[0]).toMatchObject({
      type: "income",
      category_id: "cat-livros",
    });
  });

  it("linha marcada sem categoria ou sem a outra conta aparece como pendente", () => {
    const { result } = renderReview();
    expect(result.current.problems.size).toBe(0);

    act(() => result.current.edit("padaria", { categoryId: "" }));
    act(() => result.current.edit("fatura", { counterAccountId: "" }));

    expect(result.current.problems.get("padaria")).toEqual({
      categoryId: "Escolha uma categoria.",
    });
    expect(result.current.problems.get("fatura")).toEqual({
      counterAccountId: "Escolha a outra conta da transferência.",
    });

    // Uma linha desmarcada não será salva: não há o que corrigir nela.
    act(() => result.current.toggle("padaria"));
    expect(result.current.problems.has("padaria")).toBe(false);
  });
});

describe("useImportReview: corpo da confirmação", () => {
  it("leva todas as linhas, cada uma uma vez, com o que foi sugerido", () => {
    const { result } = renderReview();

    expect(result.current.confirmItems()).toEqual([
      {
        id: "salario",
        selected: true,
        type: "income",
        amount_cents: 545_000,
        date: "2026-09-05",
        description: "SALÁRIO EMPRESA FICTÍCIA LTDA",
        category_id: "cat-salario",
        counter_account_id: null,
      },
      {
        id: "padaria",
        selected: true,
        type: "expense",
        amount_cents: 4_590,
        date: "2026-09-10",
        description: "PADARIA SÃO JOÃO",
        category_id: "cat-mercado",
        counter_account_id: null,
      },
      {
        id: "mercado",
        selected: false,
        type: "expense",
        amount_cents: 18_937,
        date: "2026-09-15",
        description: "SUPERMERCADO BOM PREÇO",
        category_id: "cat-mercado",
        counter_account_id: null,
      },
      {
        id: "tarifa",
        selected: false,
        type: "expense",
        amount_cents: 1_200,
        date: "2026-09-15",
        description: "TARIFA PACOTE DE SERVIÇOS",
        category_id: "cat-mercado",
        counter_account_id: null,
      },
      {
        id: "fatura",
        selected: true,
        type: "transfer",
        amount_cents: 80_000,
        date: "2026-09-20",
        description: "PAGAMENTO FATURA CARTÃO",
        category_id: null,
        counter_account_id: "acc-cartao",
      },
    ]);
  });

  it("leva as correções, o que foi desmarcado e a troca de tipo", () => {
    const { result } = renderReview();

    act(() => result.current.toggle("salario"));
    act(() => result.current.edit("padaria", { description: "  Padaria  ", amountCents: 5_000 }));
    // Pagamento de fatura tratado como despesa comum.
    act(() => result.current.edit("fatura", { kind: "expense", categoryId: "cat-mercado" }));
    // Despesa marcada como transferência para o cartão.
    act(() => result.current.edit("tarifa", { kind: "transfer", counterAccountId: "acc-cartao" }));

    const body = result.current.confirmItems();
    expect(body.map((line) => line.id)).toEqual([
      "salario",
      "padaria",
      "mercado",
      "tarifa",
      "fatura",
    ]);
    expect(body[0]).toMatchObject({ id: "salario", selected: false });
    expect(body[1]).toMatchObject({ description: "Padaria", amount_cents: 5_000 });
    expect(body[3]).toMatchObject({
      type: "transfer",
      category_id: null,
      counter_account_id: "acc-cartao",
    });
    expect(body[4]).toMatchObject({
      type: "expense",
      category_id: "cat-mercado",
      counter_account_id: null,
    });
  });
});

describe("reviewBalanceCents", () => {
  const check: BalanceCheck = {
    bank_balance_cents: 440_273,
    bank_balance_date: "2026-09-30",
    account_balance_cents: 0,
    counted_from: "2026-09-08",
    computed_balance_cents: 0,
    matches: false,
  };

  it("soma só as linhas marcadas, da data de referência até a data do saldo do banco", () => {
    const { result } = renderReview();

    // O salário é anterior à data de referência; ficam a padaria e o pagamento da fatura.
    expect(reviewBalanceCents(check, result.current.lines)).toBe(-4_590 - 80_000);

    act(() => result.current.toggle("fatura"));
    act(() => result.current.toggle("mercado"));
    expect(reviewBalanceCents(check, result.current.lines)).toBe(-4_590 - 18_937);
  });
});
