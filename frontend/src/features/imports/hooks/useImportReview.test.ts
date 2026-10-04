import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { ApiError } from "../../../lib/api-client";
import type { Category, CategoryTree } from "../../categories/types";
import * as importsService from "../services/importsService";
import type { BalanceCheck, Import, ImportItem, ImportItemPatch } from "../types";
import { importQueryKey } from "./useImport";
import { reviewBalanceCents, useImportReview } from "./useImportReview";

vi.mock("../services/importsService");

const getImport = vi.mocked(importsService.getImport);
const updateImportItem = vi.mocked(importsService.updateImportItem);
const selectAllImportItems = vi.mocked(importsService.selectAllImportItems);

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

/** Uma linha como o servidor a propõe: marcada e com a categoria ou a conta sugerida. */
function item(id: string, overrides: Partial<ImportItem> = {}): ImportItem {
  const proposed: ImportItem = {
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
    selected: true,
    category_id: null,
    counter_account_id: null,
    warning_code: null,
    warning_message: null,
    ...overrides,
  };
  return {
    ...proposed,
    selected: overrides.selected ?? proposed.selected_by_default,
    category_id: "category_id" in overrides ? proposed.category_id : proposed.suggested_category_id,
    counter_account_id:
      "counter_account_id" in overrides
        ? proposed.counter_account_id
        : proposed.suggested_counter_account_id,
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

const proposal = [salary, bakery, alreadyImported, probable, invoicePayment];

const IMPORT_ID = "imp-1";

function importOf(items: ImportItem[]): Import {
  return {
    id: IMPORT_ID,
    account_id: "acc-conta",
    kind: "statement",
    format: "ofx",
    original_filename: "banco_azul.ofx",
    status: "awaiting_review",
    error_code: null,
    error_message: null,
    item_count: items.length,
    imported_count: 0,
    created_at: "2026-10-03T15:00:00Z",
    completed_at: null,
    undone_at: null,
    expires_at: "2026-10-10T15:00:00Z",
    already_imported_at: null,
    items,
  };
}

/** O que o servidor guarda da revisão; os serviços falsos leem e gravam aqui. */
let saved: ImportItem[];

/** O servidor falso aplica a correção como o de verdade: o sentido da linha não muda. */
function applyOnServer(id: string, patch: ImportItemPatch): ImportItem {
  const current = saved.find((line) => line.id === id);
  if (!current) throw new Error(`linha desconhecida: ${id}`);
  const leaves =
    current.type === "expense" ||
    (current.type === "transfer" && current.transfer_direction === "out");
  const next: ImportItem = { ...current, ...patch };
  if (patch.type)
    next.transfer_direction = patch.type === "transfer" ? (leaves ? "out" : "in") : null;
  saved = saved.map((line) => (line.id === id ? next : line));
  return next;
}

/** Abre a revisão como a tela faz: lê a importação do servidor e entrega as linhas ao hook. */
function renderReview(onSaveError?: (error: unknown) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(
    () => {
      const record = useQuery({
        queryKey: importQueryKey(IMPORT_ID),
        queryFn: () => importsService.getImport(IMPORT_ID),
        initialData: importOf(saved),
        staleTime: Infinity,
      });
      return useImportReview(record.data, categories, { onSaveError });
    },
    { wrapper },
  );
}

type Review = ReturnType<typeof renderReview>["result"];

const selectedIds = (review: Review): string[] =>
  review.current.lines.filter((line) => line.selected).map((line) => line.item.id);

const lineOf = (review: Review, id: string) => {
  const line = review.current.lines.find((candidate) => candidate.item.id === id);
  if (!line) throw new Error(`a linha ${id} não está na revisão`);
  return line;
};

/** Espera a fila de alterações chegar ao servidor. */
const settled = (review: Review) => waitFor(() => expect(review.current.isSaving).toBe(false));

beforeEach(() => {
  vi.resetAllMocks();
  saved = proposal;
  getImport.mockImplementation(() => Promise.resolve(importOf(saved)));
  updateImportItem.mockImplementation((_, id, patch) => Promise.resolve(applyOnServer(id, patch)));
  selectAllImportItems.mockImplementation((_, selected) => {
    saved = saved.map((line) => ({ ...line, selected }));
    return Promise.resolve();
  });
});

describe("useImportReview: linhas marcadas", () => {
  it("duplicatas chegam desmarcadas; as outras linhas, marcadas", () => {
    const { result } = renderReview();

    expect(selectedIds(result)).toEqual(["salario", "padaria", "fatura"]);
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.allSelected).toBe(false);
    expect(updateImportItem).not.toHaveBeenCalled();
  });

  it("marca e desmarca uma linha, sem mexer nas outras, e salva cada alteração", async () => {
    const { result } = renderReview();

    act(() => result.current.toggle("padaria"));
    await waitFor(() => expect(selectedIds(result)).toEqual(["salario", "fatura"]));

    act(() => result.current.toggle("padaria"));
    act(() => result.current.toggle("mercado"));
    await waitFor(() =>
      expect(selectedIds(result)).toEqual(["salario", "padaria", "mercado", "fatura"]),
    );

    await settled(result);
    // As alterações chegam ao servidor uma por vez, na ordem em que foram feitas.
    expect(updateImportItem.mock.calls).toEqual([
      [IMPORT_ID, "padaria", { selected: false }],
      [IMPORT_ID, "padaria", { selected: true }],
      [IMPORT_ID, "mercado", { selected: true }],
    ]);
    expect(saved.filter((line) => line.selected).map((line) => line.id)).toEqual([
      "salario",
      "padaria",
      "mercado",
      "fatura",
    ]);
  });

  it("marca todas, inclusive as duplicatas, e desmarca todas", async () => {
    const { result } = renderReview();

    act(() => result.current.toggleAll(true));
    await waitFor(() => expect(result.current.allSelected).toBe(true));
    expect(result.current.selectedCount).toBe(5);

    act(() => result.current.toggleAll(false));
    await waitFor(() => expect(result.current.selectedCount).toBe(0));
    expect(result.current.allSelected).toBe(false);

    await settled(result);
    expect(selectAllImportItems.mock.calls).toEqual([
      [IMPORT_ID, true],
      [IMPORT_ID, false],
    ]);
    // Uma chamada só para todas as linhas, e não uma por linha.
    expect(updateImportItem).not.toHaveBeenCalled();
    expect(saved.some((line) => line.selected)).toBe(false);
  });
});

describe("useImportReview: correções", () => {
  it("edita valor, data, descrição e categoria de uma linha só, e salva o que mudou", async () => {
    const { result } = renderReview();

    act(() =>
      result.current.edit("padaria", {
        kind: "expense",
        amountCents: 4_950,
        date: "2026-09-11",
        description: "  Padaria São João ",
        categoryId: "cat-livros",
        counterAccountId: "",
      }),
    );

    await waitFor(() =>
      expect(lineOf(result, "padaria")).toMatchObject({
        kind: "expense",
        amountCents: 4_950,
        date: "2026-09-11",
        description: "Padaria São João",
        categoryId: "cat-livros",
        selected: true,
      }),
    );
    // A sugestão continua guardada, e as outras linhas não mudam.
    expect(lineOf(result, "padaria").item.suggested_category_id).toBe("cat-mercado");
    expect(lineOf(result, "salario")).toMatchObject({
      amountCents: 545_000,
      categoryId: "cat-salario",
    });
    await settled(result);
    // O tipo e a outra conta não mudaram: não vão ao servidor.
    expect(updateImportItem.mock.calls).toEqual([
      [
        IMPORT_ID,
        "padaria",
        {
          amount_cents: 4_950,
          date: "2026-09-11",
          description: "Padaria São João",
          category_id: "cat-livros",
        },
      ],
    ]);
  });

  it("salvar a linha sem ter mudado nada não vai ao servidor", () => {
    const { result } = renderReview();

    act(() =>
      result.current.edit("padaria", {
        kind: "expense",
        amountCents: 4_590,
        date: "2026-09-10",
        description: "PADARIA SÃO JOÃO",
        categoryId: "cat-mercado",
        counterAccountId: "",
      }),
    );

    expect(updateImportItem).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(false);
  });

  it("entrada marcada como estorno é salva como receita na categoria da compra", async () => {
    const refund = item("estorno", {
      type: "income",
      amount_cents: 5_990,
      description: "Estorno Livraria Letras & Cia",
      suggested_category_id: "cat-salario",
    });
    saved = [refund, salary];
    const { result } = renderReview();
    expect(result.current.lines.map((line) => line.kind)).toEqual(["income", "income"]);

    act(() => result.current.edit("estorno", { kind: "refund", categoryId: "cat-livros" }));

    await waitFor(() => expect(lineOf(result, "estorno").kind).toBe("refund"));
    await settled(result);
    // O tipo continua receita: o que faz o estorno é a categoria de despesa (FR-084).
    expect(updateImportItem.mock.calls).toEqual([
      [IMPORT_ID, "estorno", { category_id: "cat-livros" }],
    ]);
    expect(result.current.confirmItems()[0]).toMatchObject({
      type: "income",
      category_id: "cat-livros",
    });
  });

  it("despesa marcada como transferência sai da conta, e de volta a despesa perde o sentido", async () => {
    const { result } = renderReview();

    act(() => result.current.edit("padaria", { kind: "transfer", counterAccountId: "acc-cartao" }));

    await waitFor(() => expect(lineOf(result, "padaria").kind).toBe("transfer"));
    expect(lineOf(result, "padaria").item.transfer_direction).toBe("out");
    await settled(result);
    expect(updateImportItem).toHaveBeenLastCalledWith(IMPORT_ID, "padaria", {
      type: "transfer",
      counter_account_id: "acc-cartao",
    });

    act(() => result.current.edit("padaria", { kind: "expense" }));

    await waitFor(() => expect(lineOf(result, "padaria").kind).toBe("expense"));
    expect(lineOf(result, "padaria").item.transfer_direction).toBeNull();
    await settled(result);
  });

  it("linha marcada sem categoria ou sem a outra conta aparece como pendente", async () => {
    const { result } = renderReview();
    expect(result.current.problems.size).toBe(0);

    act(() => result.current.edit("padaria", { categoryId: "" }));
    act(() => result.current.edit("fatura", { counterAccountId: "" }));

    await waitFor(() => expect(result.current.problems.size).toBe(2));
    expect(result.current.problems.get("padaria")).toEqual({
      categoryId: "Escolha uma categoria.",
    });
    expect(result.current.problems.get("fatura")).toEqual({
      counterAccountId: "Escolha a outra conta da transferência.",
    });

    // Uma linha desmarcada não será salva: não há o que corrigir nela.
    act(() => result.current.toggle("padaria"));
    await waitFor(() => expect(result.current.problems.has("padaria")).toBe(false));
    await settled(result);
  });
});

describe("useImportReview: revisão retomada", () => {
  it("quem sai e volta encontra as linhas como as deixou", async () => {
    const first = renderReview();
    act(() => first.result.current.toggle("salario"));
    act(() => first.result.current.toggle("tarifa"));
    act(() =>
      first.result.current.edit("padaria", { description: "Padaria", categoryId: "cat-livros" }),
    );
    await waitFor(() => expect(updateImportItem).toHaveBeenCalledTimes(3));
    await settled(first.result);
    first.unmount();

    // Outra visita à página: o que vale é o que o servidor guardou.
    const { result } = renderReview();

    expect(selectedIds(result)).toEqual(["padaria", "tarifa", "fatura"]);
    expect(lineOf(result, "padaria")).toMatchObject({
      description: "Padaria",
      categoryId: "cat-livros",
    });
    // O que veio sugerido continua registrado ao lado do que foi decidido.
    expect(lineOf(result, "tarifa").item.selected_by_default).toBe(false);
    expect(lineOf(result, "padaria").item.suggested_category_id).toBe("cat-mercado");
  });

  it("depois de salvar, confere com o servidor o que ficou guardado", async () => {
    const { result } = renderReview();
    // O servidor grava algo que a tela não previu: a conferência traz o que ficou salvo.
    updateImportItem.mockImplementation((_, id, patch) => {
      const next = { ...applyOnServer(id, patch), description: "Padaria (servidor)" };
      saved = saved.map((line) => (line.id === id ? next : line));
      return Promise.resolve(next);
    });

    act(() => result.current.toggle("padaria"));

    await waitFor(() => expect(lineOf(result, "padaria").description).toBe("Padaria (servidor)"));
    expect(getImport).toHaveBeenCalledTimes(1);
    expect(lineOf(result, "padaria").selected).toBe(false);
  });

  it("alteração recusada: a linha volta ao que estava salvo e a tela é avisada", async () => {
    const refusal = new ApiError({
      status: 422,
      code: "validation_error",
      message: "Confira os campos destacados.",
      details: { fields: { category_id: "Esta categoria está arquivada." } },
    });
    // O servidor só responde depois que a tela já mostrou a alteração.
    let refuse: (error: unknown) => void = () => undefined;
    updateImportItem.mockImplementationOnce(
      () => new Promise<ImportItem>((_, reject) => (refuse = reject)),
    );
    const onSaveError = vi.fn();
    const { result } = renderReview(onSaveError);

    act(() => result.current.edit("padaria", { categoryId: "cat-livros" }));
    await waitFor(() => expect(lineOf(result, "padaria").categoryId).toBe("cat-livros"));
    expect(result.current.isSaving).toBe(true);

    act(() => refuse(refusal));

    await waitFor(() => expect(onSaveError).toHaveBeenCalledWith(refusal));
    await waitFor(() => expect(lineOf(result, "padaria").categoryId).toBe("cat-mercado"));
    await settled(result);
    expect(saved).toEqual(proposal);
  });

  it("falha ao marcar todas: cada linha volta à marcação que tinha", async () => {
    let fail: (error: unknown) => void = () => undefined;
    selectAllImportItems.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    const onSaveError = vi.fn();
    const { result } = renderReview(onSaveError);

    act(() => result.current.toggleAll(true));
    await waitFor(() => expect(result.current.allSelected).toBe(true));

    act(() => fail(new Error("sem conexão")));

    await waitFor(() => expect(onSaveError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(selectedIds(result)).toEqual(["salario", "padaria", "fatura"]));
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

  it("leva as correções, o que foi desmarcado e a troca de tipo", async () => {
    const { result } = renderReview();

    act(() => result.current.toggle("salario"));
    act(() => result.current.edit("padaria", { description: "  Padaria  ", amountCents: 5_000 }));
    // Pagamento de fatura tratado como despesa comum.
    act(() => result.current.edit("fatura", { kind: "expense", categoryId: "cat-mercado" }));
    // Despesa marcada como transferência para o cartão.
    act(() => result.current.edit("tarifa", { kind: "transfer", counterAccountId: "acc-cartao" }));
    await waitFor(() => expect(lineOf(result, "tarifa").kind).toBe("transfer"));

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
    await settled(result);
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

  it("soma só as linhas marcadas, da data de referência até a data do saldo do banco", async () => {
    const { result } = renderReview();

    // O salário é anterior à data de referência; ficam a padaria e o pagamento da fatura.
    expect(reviewBalanceCents(check, result.current.lines)).toBe(-4_590 - 80_000);

    act(() => result.current.toggle("fatura"));
    act(() => result.current.toggle("mercado"));
    await waitFor(() =>
      expect(reviewBalanceCents(check, result.current.lines)).toBe(-4_590 - 18_937),
    );
    await settled(result);
  });
});
