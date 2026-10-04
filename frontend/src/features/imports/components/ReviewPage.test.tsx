import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import { importReviewPath, paths } from "../../../lib/paths";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import type { Category, CategoryTree } from "../../categories/types";
import * as importsService from "../services/importsService";
import type { Import, ImportItem } from "../types";
import { ReviewPage } from "./ReviewPage";

vi.mock("../services/importsService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");

const getImport = vi.mocked(importsService.getImport);
const confirmImport = vi.mocked(importsService.confirmImport);
const updateImportItem = vi.mocked(importsService.updateImportItem);
const selectAllImportItems = vi.mocked(importsService.selectAllImportItems);
const listAccounts = vi.mocked(accountsService.listAccounts);
const listCategories = vi.mocked(categoriesService.listCategories);

function account(id: string, name: string, type: Account["type"] = "checking"): Account {
  return {
    id,
    type,
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-09-01",
    closing_day: type === "credit_card" ? 10 : null,
    due_day: type === "credit_card" ? 17 : null,
    archived: false,
    balance_cents: 0,
  };
}

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

/** Uma linha como o servidor a propõe: marcada e com a categoria sugerida. */
function item(id: string, overrides: Partial<ImportItem>): ImportItem {
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
    selected: proposed.selected_by_default,
    category_id: proposed.suggested_category_id,
    counter_account_id: proposed.suggested_counter_account_id,
  };
}

const WARNING =
  "Esta linha parece o pagamento de uma fatura de cartão. Se você também lança as compras do " +
  "cartão no Contaí, cadastre o cartão e marque esta linha como pagamento de fatura, para não " +
  "contar o gasto duas vezes.";

const items: ImportItem[] = [
  item("salario", {
    row_index: 0,
    type: "income",
    amount_cents: 545_000,
    date: "2026-09-05",
    description: "SALÁRIO EMPRESA",
    suggested_category_id: "cat-salario",
  }),
  item("padaria", { row_index: 1 }),
  item("mercado", {
    row_index: 2,
    amount_cents: 18_937,
    date: "2026-09-15",
    description: "SUPERMERCADO BOM PREÇO",
    duplicate_status: "exact",
    selected_by_default: false,
  }),
  item("tarifa", {
    row_index: 3,
    amount_cents: 1_200,
    date: "2026-09-15",
    description: "TARIFA PACOTE",
    duplicate_status: "probable",
    selected_by_default: false,
  }),
  item("fatura", {
    row_index: 4,
    amount_cents: 80_000,
    date: "2026-09-20",
    description: "PAGAMENTO FATURA CARTÃO",
    warning_code: "invoice_payment_without_card",
    warning_message: WARNING,
  }),
];

/** As linhas que o servidor guarda; as correções salvas pela tela mudam o que está aqui. */
let saved: ImportItem[];

function importOf(overrides: Partial<Import> = {}): Import {
  return {
    id: "imp-1",
    account_id: "acc-conta",
    kind: "statement",
    format: "ofx",
    original_filename: "banco_azul.ofx",
    status: "awaiting_review",
    error_code: null,
    error_message: null,
    item_count: saved.length,
    imported_count: 0,
    created_at: "2026-10-03T15:00:00Z",
    completed_at: null,
    undone_at: null,
    expires_at: "2026-10-10T15:00:00Z",
    already_imported_at: null,
    items: saved,
    total_check: null,
    balance_check: {
      bank_balance_cents: 460_410,
      bank_balance_date: "2026-09-30",
      account_balance_cents: 0,
      counted_from: "2026-09-01",
      computed_balance_cents: 460_410,
      matches: true,
    },
    ...overrides,
  };
}

function renderReview() {
  const router = createMemoryRouter(
    [
      { path: paths.importReview, element: <ReviewPage /> },
      { path: paths.imports, element: <h1>Histórico</h1> },
    ],
    { initialEntries: [importReviewPath("imp-1")] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, unmount: view.unmount };
}

const rowOf = (description: string): HTMLElement => {
  const row = screen.getByRole("button", { name: new RegExp(description) }).closest("li");
  if (!row) throw new Error(`A linha ${description} não foi desenhada`);
  return row;
};

const lineBox = (description: string): HTMLElement =>
  within(rowOf(description)).getByRole("checkbox");

/** O botão de importar fica em espera enquanto uma alteração ainda está sendo salva. */
const importButton = async (name: string): Promise<HTMLElement> => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  return button;
};

beforeEach(() => {
  vi.resetAllMocks();
  saved = items;
  getImport.mockImplementation(() => Promise.resolve(importOf()));
  updateImportItem.mockImplementation((_, id, patch) => {
    saved = saved.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      // A despesa marcada como transferência sai da conta; de volta a despesa, perde o sentido.
      if (patch.type) next.transfer_direction = patch.type === "transfer" ? "out" : null;
      return next;
    });
    const line = saved.find((candidate) => candidate.id === id);
    return line ? Promise.resolve(line) : Promise.reject(new Error("linha desconhecida"));
  });
  selectAllImportItems.mockImplementation((_, selected) => {
    saved = saved.map((line) => ({ ...line, selected }));
    return Promise.resolve();
  });
  listAccounts.mockResolvedValue([
    account("acc-conta", "Conta Principal"),
    account("acc-cartao", "Cartão Verde", "credit_card"),
  ]);
  listCategories.mockResolvedValue(categories);
});

describe("ReviewPage", () => {
  it("duplicatas vêm desmarcadas, com o selo e o texto de que não serão importadas", async () => {
    renderReview();

    expect(await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ })).toBeVisible();
    expect(lineBox("PADARIA SÃO JOÃO")).toBeChecked();
    expect(rowOf("PADARIA SÃO JOÃO")).toHaveTextContent("Mercado");

    expect(lineBox("SUPERMERCADO BOM PREÇO")).not.toBeChecked();
    expect(rowOf("SUPERMERCADO BOM PREÇO")).toHaveTextContent("Não será importada");
    expect(rowOf("SUPERMERCADO BOM PREÇO")).toHaveTextContent("Já importada");
    expect(lineBox("TARIFA PACOTE")).not.toBeChecked();
    expect(rowOf("TARIFA PACOTE")).toHaveTextContent("Possível duplicata");

    expect(screen.getByText("3 de 5 marcadas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar 3 lançamentos" })).toBeInTheDocument();
    expect(screen.getByText(/disponível por 7 dias, até 10 de out\. às 12:00/)).toBeVisible();
    // Abrir a revisão não grava nada.
    expect(updateImportItem).not.toHaveBeenCalled();
  });

  it("fatura em PDF cuja soma confere com o total do documento mostra a conferência", async () => {
    const pdf = {
      format: "pdf" as const,
      original_filename: "fatura.pdf",
      balance_check: null,
      total_check: { document_total_cents: 125_046, extracted_total_cents: 125_046, matches: true },
    };
    getImport.mockImplementation(() => Promise.resolve(importOf(pdf)));
    renderReview();

    expect(await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ })).toBeVisible();
    expect(
      screen.getByText(/A soma das linhas lidas confere com o total do documento/),
    ).toHaveTextContent("confere com o total do documento: R$ 1.250,46.");
    expect(screen.queryByText(/não bate com o total do documento/)).toBeNull();
  });

  it("soma diferente do total do documento avisa com os dois valores e deixa importar", async () => {
    const pdf = {
      format: "pdf" as const,
      original_filename: "fatura.pdf",
      balance_check: null,
      total_check: {
        document_total_cents: 125_046,
        extracted_total_cents: 128_046,
        matches: false,
      },
    };
    getImport.mockImplementation(() => Promise.resolve(importOf(pdf)));
    renderReview();

    expect(await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ })).toBeVisible();
    expect(screen.getByText(/não bate com o total do documento/)).toHaveTextContent(
      "O documento informa R$ 1.250,46; as linhas lidas somam R$ 1.280,46. Confira se falta ou sobra alguma linha.",
    );
    expect(screen.queryByText(/confere com o total do documento/)).toBeNull();
    // A divergência avisa, e não impede a importação.
    expect(await importButton("Importar 3 lançamentos")).not.toHaveAttribute("aria-disabled");
  });

  it("marcar todas e desmarcar uma linha atualizam a contagem e o saldo, e são salvas", async () => {
    const user = userEvent.setup();
    renderReview();
    await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ });
    expect(screen.getByText(/O saldo confere com o do banco/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Marcar todas" }));

    expect(await screen.findByText("5 de 5 marcadas")).toBeInTheDocument();
    // As duas duplicatas entraram na conta: o saldo deixa de bater, e a tela mostra os dois.
    const warning = screen.getByText(/O saldo não bate com o do banco/);
    expect(warning).toHaveTextContent("Em 30 de set., o banco informa R$ 4.604,10");
    expect(warning).toHaveTextContent("a conta fica com R$ 4.402,73: diferença de R$ 201,37");

    await user.click(lineBox("TARIFA PACOTE"));

    expect(await screen.findByText("4 de 5 marcadas")).toBeInTheDocument();
    expect(rowOf("TARIFA PACOTE")).toHaveTextContent("Não será importada");
    await waitFor(() =>
      expect(updateImportItem).toHaveBeenCalledWith("imp-1", "tarifa", { selected: false }),
    );
    expect(selectAllImportItems).toHaveBeenCalledWith("imp-1", true);
    expect(saved.filter((line) => line.selected).map((line) => line.id)).toEqual([
      "salario",
      "padaria",
      "mercado",
      "fatura",
    ]);
  });

  it("avisa do pagamento de fatura sem cartão e deixa marcar a linha como transferência", async () => {
    const user = userEvent.setup();
    renderReview();
    await screen.findByRole("button", { name: /PAGAMENTO FATURA CARTÃO/ });

    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(rowOf("PAGAMENTO FATURA CARTÃO")).toHaveTextContent("Parece pagamento de fatura");

    await user.click(screen.getByRole("button", { name: /PAGAMENTO FATURA CARTÃO/ }));
    const sheet = await screen.findByRole("dialog", { name: "Corrigir linha" });
    await user.click(within(sheet).getByRole("radio", { name: "Transferência" }));
    // Com um cartão só, a transferência já vem apontada para ele.
    expect(within(sheet).getByRole("combobox", { name: "Entra em" })).toHaveValue("acc-cartao");
    await user.click(within(sheet).getByRole("button", { name: "Salvar linha" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(rowOf("PAGAMENTO FATURA CARTÃO")).toHaveTextContent("Transferência para Cartão Verde"),
    );
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(rowOf("PAGAMENTO FATURA CARTÃO")).not.toHaveTextContent("Parece pagamento de fatura");
    // Só o que mudou vai ao servidor.
    expect(updateImportItem).toHaveBeenCalledWith("imp-1", "fatura", {
      type: "transfer",
      counter_account_id: "acc-cartao",
    });
  });

  it("uma entrada pode ser marcada como estorno, na categoria da compra, e vai assim na confirmação", async () => {
    const user = userEvent.setup();
    confirmImport.mockImplementation(() =>
      Promise.resolve(importOf({ status: "completed", imported_count: 3, items: null })),
    );
    const { router } = renderReview();

    await user.click(await screen.findByRole("button", { name: /SALÁRIO EMPRESA/ }));
    const sheet = await screen.findByRole("dialog", { name: "Corrigir linha" });
    // Uma entrada não vira despesa: as opções são receita, estorno e transferência.
    expect(within(sheet).queryByRole("radio", { name: "Despesa" })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: "Estorno" }));

    // As categorias passam a ser as de despesa, e a de receita escolhida deixa de valer.
    const categoryField = within(sheet).getByRole("combobox", { name: "Categoria da compra" });
    expect(categoryField).toHaveValue("");
    await user.click(within(sheet).getByRole("button", { name: "Salvar linha" }));
    expect(await within(sheet).findByText("Escolha uma categoria.")).toBeVisible();
    expect(updateImportItem).not.toHaveBeenCalled();

    await user.selectOptions(categoryField, "Livros");
    await user.click(within(sheet).getByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(rowOf("SALÁRIO EMPRESA")).toHaveTextContent("Estorno · Livros"));
    // O estorno é salvo como a mesma receita, agora na categoria de despesa da compra.
    expect(updateImportItem.mock.calls).toEqual([
      ["imp-1", "salario", { category_id: "cat-livros" }],
    ]);

    await user.click(await importButton("Importar 3 lançamentos"));

    await waitFor(() => expect(router.state.location.pathname).toBe(paths.imports));
    expect(confirmImport).toHaveBeenCalledTimes(1);
    const [id, body] = confirmImport.mock.calls[0] ?? [];
    expect(id).toBe("imp-1");
    expect(body).toHaveLength(5);
    expect(body?.[0]).toEqual({
      id: "salario",
      selected: true,
      type: "income",
      amount_cents: 545_000,
      date: "2026-09-05",
      description: "SALÁRIO EMPRESA",
      category_id: "cat-livros",
      counter_account_id: null,
    });
    expect(body?.filter((line) => line.selected).map((line) => line.id)).toEqual([
      "salario",
      "padaria",
      "fatura",
    ]);
    // O aviso entra na tela com uma transição: confere-se a presença, e não a opacidade.
    expect(
      await screen.findByText("3 lançamentos importados em Conta Principal."),
    ).toBeInTheDocument();
  });

  it("quem sai da página e volta encontra a revisão como a deixou", async () => {
    const user = userEvent.setup();
    const first = renderReview();
    await user.click(await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ }));
    const sheet = await screen.findByRole("dialog", { name: "Corrigir linha" });
    await user.clear(within(sheet).getByRole("textbox", { name: "Descrição" }));
    await user.type(within(sheet).getByRole("textbox", { name: "Descrição" }), "Café na padaria");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Categoria" }), "Livros");
    await user.click(within(sheet).getByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(lineBox("SALÁRIO EMPRESA"));
    await user.click(lineBox("TARIFA PACOTE"));
    await importButton("Importar 3 lançamentos");
    expect(updateImportItem).toHaveBeenCalledTimes(3);

    // Sai da página e abre de novo, sem nada na memória: vale o que o servidor guardou.
    first.unmount();
    renderReview();

    expect(await screen.findByRole("button", { name: /Café na padaria/ })).toBeVisible();
    expect(rowOf("Café na padaria")).toHaveTextContent("Livros");
    expect(lineBox("Café na padaria")).toBeChecked();
    expect(lineBox("SALÁRIO EMPRESA")).not.toBeChecked();
    expect(rowOf("SALÁRIO EMPRESA")).toHaveTextContent("Não será importada");
    // A provável duplicata que o usuário marcou continua marcada, com o selo.
    expect(lineBox("TARIFA PACOTE")).toBeChecked();
    expect(rowOf("TARIFA PACOTE")).toHaveTextContent("Possível duplicata");
    expect(screen.getByText("3 de 5 marcadas")).toBeInTheDocument();
    expect(screen.getByText(/Você pode sair e continuar esta revisão depois/)).toBeVisible();
  });

  it("alteração que não foi salva: a linha volta ao que estava e a tela diz o que fazer", async () => {
    const user = userEvent.setup();
    updateImportItem.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    renderReview();
    await screen.findByRole("button", { name: /PADARIA SÃO JOÃO/ });

    await user.click(lineBox("PADARIA SÃO JOÃO"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A alteração não foi salva. Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
    );
    await waitFor(() => expect(lineBox("PADARIA SÃO JOÃO")).toBeChecked());
    expect(screen.getByText("3 de 5 marcadas")).toBeInTheDocument();
  });

  it("linha recusada pelo servidor fica destacada, com o que fazer", async () => {
    const user = userEvent.setup();
    confirmImport.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "validation_error",
        message: "Confira os campos destacados.",
        details: { fields: { "items.1.category_id": "Esta categoria está arquivada." } },
      }),
    );
    renderReview();
    Element.prototype.scrollIntoView = vi.fn();

    await user.click(await screen.findByRole("button", { name: "Importar 3 lançamentos" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Corrija 1 linha antes de importar");
    expect(rowOf("PADARIA SÃO JOÃO")).toHaveTextContent("Esta categoria está arquivada.");
  });
});
