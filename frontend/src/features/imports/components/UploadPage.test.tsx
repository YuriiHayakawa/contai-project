import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ApiError } from "../../../lib/api-client";
import { importPath, paths } from "../../../lib/paths";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import { AuthProvider, sessionQueryKey } from "../../auth/hooks/useAuth";
import type { CurrentUser } from "../../auth/types";
import * as importsService from "../services/importsService";
import type { Import } from "../types";
import { UploadPage } from "./UploadPage";

vi.mock("../services/importsService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../auth/services/authService");

const uploadImport = vi.mocked(importsService.uploadImport);
const getImport = vi.mocked(importsService.getImport);
const listAccounts = vi.mocked(accountsService.listAccounts);

const STATEMENT_FIELD = "Arquivo do extrato ou da fatura";
const RECEIPT_FIELD = "Foto ou PDF do comprovante";

const user: CurrentUser = {
  name: "Ana",
  email: "ana@exemplo.test",
  status: "active",
  two_factor_enabled: false,
  // O aviso já foi aceito: estes testes tratam do envio e do andamento.
  ai_documents_consent: true,
  deletion_scheduled_at: null,
};

const card: Account = {
  id: "acc-card",
  type: "credit_card",
  name: "Cartão Verde",
  institution: null,
  initial_balance_cents: 0,
  initial_balance_date: "2026-09-01",
  closing_day: 3,
  due_day: 10,
  credit_limit_cents: null,
  archived: false,
  balance_cents: 0,
};

function importOf(overrides: Partial<Import> = {}): Import {
  return {
    id: "imp-1",
    account_id: "acc-card",
    kind: "statement",
    format: "pdf",
    original_filename: "fatura.pdf",
    status: "queued",
    error_code: null,
    error_message: null,
    item_count: 0,
    imported_count: 0,
    created_at: "2026-10-04T15:00:00Z",
    completed_at: null,
    undone_at: null,
    expires_at: null,
    already_imported_at: null,
    ...overrides,
  };
}

const PDF = new File(["%PDF-1.7 fatura fictícia"], "fatura.pdf", { type: "application/pdf" });
const PHOTO = new File(["foto fictícia"], "recibo.jpg", { type: "image/jpeg" });

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, user);
  const router = createMemoryRouter(
    [
      { path: paths.importNew, element: <UploadPage /> },
      { path: paths.importDetail, element: <UploadPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

function apiError(status: number, code: string, message: string, fields?: Record<string, string>) {
  return new ApiError({ status, code, message, details: fields ? { fields } : null });
}

beforeEach(() => {
  vi.resetAllMocks();
  listAccounts.mockResolvedValue([card]);
  uploadImport.mockResolvedValue(importOf());
  getImport.mockResolvedValue(importOf());
});

describe("UploadPage: o que enviar", () => {
  it("começa em extrato ou fatura, que aceita PDF além de OFX, CSV e planilha", async () => {
    renderAt(paths.importNew);

    const field = await screen.findByLabelText(STATEMENT_FIELD);
    expect(screen.getByRole("radio", { name: "Extrato ou fatura" })).toBeChecked();
    expect(field).toHaveAttribute("accept", ".ofx,.qfx,.csv,.txt,.xlsx,.pdf");
    expect(field).toHaveAccessibleDescription(
      /OFX, CSV, planilha Excel \(\.xlsx\) ou PDF, de até 10 MB.*O PDF é lido por um serviço de IA externo/,
    );
  });

  it("o comprovante aceita foto e PDF e vai ao servidor como comprovante", async () => {
    const actor = userEvent.setup();
    uploadImport.mockResolvedValue(importOf({ kind: "receipt", format: "image" }));
    const router = renderAt(paths.importNew);

    await actor.click(await screen.findByRole("radio", { name: "Comprovante" }));
    const field = screen.getByLabelText(RECEIPT_FIELD);
    expect(field).toHaveAttribute("accept", expect.stringContaining(".jpg,.jpeg,.png,.pdf"));
    expect(field).toHaveAccessibleDescription(/Vira um lançamento só/);
    await actor.upload(field, PHOTO);
    await actor.click(screen.getByRole("button", { name: "Enviar arquivo" }));

    expect(await screen.findByRole("heading", { name: "Arquivo recebido" })).toBeInTheDocument();
    expect(uploadImport).toHaveBeenCalledWith(PHOTO, "acc-card", "receipt");
    expect(router.state.location.pathname).toBe(importPath("imp-1"));
  });

  it("trocar o que vai ser enviado esvazia o arquivo escolhido", async () => {
    const actor = userEvent.setup();
    renderAt(paths.importNew);
    await actor.upload(await screen.findByLabelText(STATEMENT_FIELD), PDF);
    expect(screen.getByText(/fatura\.pdf/)).toBeInTheDocument();

    await actor.click(screen.getByRole("radio", { name: "Comprovante" }));
    await actor.click(screen.getByRole("button", { name: "Enviar arquivo" }));

    expect(screen.queryByText(/fatura\.pdf/)).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escolha a foto ou o PDF do comprovante.",
    );
    expect(uploadImport).not.toHaveBeenCalled();
  });

  it("o limite do dia aparece com a mensagem de quando volta", async () => {
    const actor = userEvent.setup();
    uploadImport.mockRejectedValue(
      apiError(
        429,
        "ai_limit_reached",
        "Você atingiu o limite de documentos lidos pela IA por hoje. Amanhã você pode enviar de novo; arquivos OFX, CSV e planilhas continuam funcionando.",
      ),
    );
    renderAt(paths.importNew);

    await actor.upload(await screen.findByLabelText(STATEMENT_FIELD), PDF);
    await actor.click(screen.getByRole("button", { name: "Enviar arquivo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Amanhã você pode enviar de novo; arquivos OFX, CSV e planilhas continuam funcionando.",
    );
  });

  it.each([
    [
      "PDF com senha",
      apiError(415, "unsupported_file", "Este PDF está protegido por senha. Envie a cópia."),
      "Este PDF está protegido por senha. Envie a cópia.",
    ],
    [
      "foto enviada como extrato",
      apiError(422, "validation_error", "Confira os campos destacados.", {
        kind: "Uma foto é lida como comprovante, com um lançamento só.",
      }),
      "Uma foto é lida como comprovante, com um lançamento só.",
    ],
  ])("%s: a recusa aparece junto do arquivo", async (_, error, message) => {
    const actor = userEvent.setup();
    uploadImport.mockRejectedValue(error);
    renderAt(paths.importNew);

    const field = await screen.findByLabelText(STATEMENT_FIELD);
    await actor.upload(field, PDF);
    await actor.click(screen.getByRole("button", { name: "Enviar arquivo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(field).toBeInvalid();
  });
});

describe("UploadPage: andamento de um documento lido por IA", () => {
  it("enquanto o documento é lido, diz que a leitura por IA leva mais tempo", async () => {
    getImport.mockResolvedValue(importOf({ status: "processing" }));
    renderAt(importPath("imp-1"));

    expect(await screen.findByRole("heading", { name: "Lendo o arquivo…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "A leitura por IA pode levar cerca de um minuto.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("fatura.pdf · Cartão Verde");
  });

  it("com o serviço de IA ocupado, avisa que tenta de novo sem reenvio do arquivo", async () => {
    getImport.mockResolvedValue(
      importOf({
        error_code: "ai_busy",
        error_message:
          "O serviço de IA está ocupado agora. Vamos tentar de novo em instantes, sem você precisar reenviar o arquivo.",
      }),
    );
    renderAt(importPath("imp-1"));

    expect(
      await screen.findByRole("heading", { name: "Aguardando o serviço de IA" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vamos tentar de novo em instantes, sem você precisar reenviar o arquivo.",
    );
    // Não é um erro: não há aviso de falha nem pedido de novo envio.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar outro arquivo" })).toBeNull();
  });

  it("com a cota do dia do serviço de IA esgotada, diz que volta a funcionar amanhã", async () => {
    getImport.mockResolvedValue(
      importOf({
        status: "failed",
        error_code: "ai_quota_exhausted",
        error_message:
          "O limite de hoje do serviço de IA foi atingido, e ele volta a funcionar amanhã. Nada foi salvo. Envie o arquivo de novo amanhã; OFX, CSV e planilhas continuam funcionando.",
      }),
    );
    renderAt(importPath("imp-1"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O limite de hoje do serviço de IA foi atingido, e ele volta a funcionar amanhã.",
    );
    expect(screen.getByRole("heading", { name: "Não deu para importar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar outro arquivo" })).toBeInTheDocument();
  });

  it("documento que a IA não conseguiu ler: nada foi salvo, e a tela diz o que tentar", async () => {
    getImport.mockResolvedValue(
      importOf({
        status: "failed",
        error_code: "document_unreadable",
        error_message:
          "Não conseguimos reconhecer lançamentos neste documento. Nada foi salvo. Confira se é o extrato, a fatura ou o comprovante certo.",
      }),
    );
    renderAt(importPath("imp-1"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nada foi salvo.");
    expect(screen.getByText("Arquivo: fatura.pdf")).toBeInTheDocument();
  });
});
