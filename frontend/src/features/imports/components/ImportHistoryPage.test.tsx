import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { importReviewPath, paths } from "../../../lib/paths";
import * as accountsService from "../../accounts/services/accountsService";
import * as importsService from "../services/importsService";
import type { Import } from "../types";
import { ImportHistoryPage } from "./ImportHistoryPage";

vi.mock("../services/importsService");
vi.mock("../../accounts/services/accountsService");

const listImports = vi.mocked(importsService.listImports);
const undoImport = vi.mocked(importsService.undoImport);
const listAccounts = vi.mocked(accountsService.listAccounts);

function importOf(id: string, overrides: Partial<Import>): Import {
  return {
    id,
    account_id: "acc-conta",
    kind: "statement",
    format: "ofx",
    original_filename: `${id}.ofx`,
    status: "completed",
    error_code: null,
    error_message: null,
    item_count: 0,
    imported_count: 0,
    created_at: "2026-09-28T15:00:00Z",
    completed_at: null,
    undone_at: null,
    expires_at: null,
    already_imported_at: null,
    ...overrides,
  };
}

const completed = importOf("concluida", { imported_count: 4 });
const history: Import[] = [
  importOf("revisar", {
    status: "awaiting_review",
    item_count: 5,
    expires_at: "2026-10-05T15:00:00Z",
  }),
  completed,
  importOf("desfeita", { status: "undone", imported_count: 2 }),
  importOf("expirada", {
    status: "failed",
    error_code: "review_expired",
    error_message:
      "O prazo de 7 dias para revisar esta importação terminou. Nada foi salvo. Envie o arquivo de novo.",
  }),
];

function renderHistory() {
  const router = createMemoryRouter(
    [
      { path: paths.imports, element: <ImportHistoryPage /> },
      { path: paths.importReview, element: <h1>Revisão</h1> },
      { path: paths.importNew, element: <h1>Envio</h1> },
    ],
    { initialEntries: [paths.imports] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

const rowOf = (filename: string): HTMLElement => {
  const row = screen.getByRole("heading", { name: filename }).closest("li");
  if (!row) throw new Error(`A importação ${filename} não foi desenhada`);
  return row;
};

beforeEach(() => {
  vi.resetAllMocks();
  listImports.mockResolvedValue({ items: history, next_cursor: null });
  listAccounts.mockResolvedValue([
    {
      id: "acc-conta",
      type: "checking",
      name: "Conta Principal",
      institution: null,
      initial_balance_cents: 0,
      initial_balance_date: "2026-09-01",
      closing_day: null,
      due_day: null,
      archived: false,
      balance_cents: 0,
    },
  ]);
});

describe("ImportHistoryPage", () => {
  it("mostra arquivo, data, conta, quantidade e situação de cada importação", async () => {
    renderHistory();

    await screen.findByRole("heading", { name: "concluida.ofx" });
    const done = rowOf("concluida.ofx");
    expect(done).toHaveTextContent("concluida.ofx");
    expect(done).toHaveTextContent("28 de set.");
    expect(done).toHaveTextContent("Conta Principal");
    expect(done).toHaveTextContent("Concluída");
    expect(done).toHaveTextContent("4 lançamentos");

    expect(rowOf("revisar.ofx")).toHaveTextContent("Esperando a revisão");
    expect(rowOf("revisar.ofx")).toHaveTextContent("5 linhas");
    expect(rowOf("revisar.ofx")).toHaveTextContent(
      "Disponível para revisão até 5 de out. às 12:00.",
    );
    expect(rowOf("desfeita.ofx")).toHaveTextContent("Desfeita");
    expect(rowOf("desfeita.ofx")).toHaveTextContent("2 lançamentos removidos");
  });

  it('importação expirada aparece como "Expirada", com a orientação de enviar de novo', async () => {
    const user = userEvent.setup();
    const router = renderHistory();

    await screen.findByRole("heading", { name: "expirada.ofx" });
    const expired = rowOf("expirada.ofx");
    expect(expired).toHaveTextContent("Expirada");
    expect(expired).toHaveTextContent("Nada foi salvo. Envie o arquivo de novo.");

    await user.click(within(expired).getByRole("button", { name: "Enviar de novo" }));

    expect(router.state.location.pathname).toBe(paths.importNew);
  });

  it("a importação à espera leva à revisão", async () => {
    const user = userEvent.setup();
    const router = renderHistory();
    await screen.findByRole("heading", { name: "revisar.ofx" });

    await user.click(within(rowOf("revisar.ofx")).getByRole("button", { name: "Revisar" }));

    expect(router.state.location.pathname).toBe(importReviewPath("revisar"));
  });

  it("desfazer pede confirmação e só então remove os lançamentos", async () => {
    const user = userEvent.setup();
    undoImport.mockResolvedValue({ ...completed, status: "undone" });
    renderHistory();
    await screen.findByRole("heading", { name: "concluida.ofx" });

    await user.click(within(rowOf("concluida.ofx")).getByRole("button", { name: "Desfazer" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Desfazer esta importação?" });
    expect(dialog).toHaveTextContent(
      "Os 4 lançamentos criados por concluida.ofx saem de Conta Principal de uma vez.",
    );
    expect(undoImport).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Desfazer importação" }));

    await waitFor(() => expect(undoImport).toHaveBeenCalledWith("concluida"));
    // O aviso entra na tela com uma transição: confere-se a presença, e não a opacidade.
    expect(
      await screen.findByText("Importação desfeita: 4 lançamentos removidos."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("sem importações, convida a enviar o primeiro extrato", async () => {
    listImports.mockResolvedValue({ items: [], next_cursor: null });
    renderHistory();

    expect(
      await screen.findByRole("heading", { name: "Importe seu primeiro extrato" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Importar extrato" })).toBeInTheDocument();
  });
});
