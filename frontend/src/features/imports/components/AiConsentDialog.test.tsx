import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ApiError } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
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
const acceptAiDocuments = vi.mocked(importsService.acceptAiDocuments);
const listAccounts = vi.mocked(accountsService.listAccounts);

const NOTICE = "Este arquivo será lido por um serviço de IA";

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

const queued: Import = {
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
};

const PDF = new File(["%PDF-1.7 fatura fictícia"], "fatura.pdf", { type: "application/pdf" });
const PHOTO = new File(["foto fictícia"], "recibo.png", { type: "image/png" });
const OFX = new File(["<OFX>"], "extrato.ofx", { type: "" });

let queryClient: QueryClient;

/** A tela de envio, com o usuário já conectado: com ou sem o aceite do aviso. */
function renderUpload(consent: boolean) {
  const user: CurrentUser = {
    name: "Ana",
    email: "ana@exemplo.test",
    status: "active",
    two_factor_enabled: false,
    ai_documents_consent: consent,
    deletion_scheduled_at: null,
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, user);
  const router = createMemoryRouter(
    [
      { path: paths.importNew, element: <UploadPage /> },
      { path: paths.importDetail, element: <h1>Andamento da importação</h1> },
    ],
    { initialEntries: [paths.importNew] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function send(user: UserEvent, file: File, label = "Arquivo do extrato ou da fatura") {
  await user.upload(await screen.findByLabelText(label), file);
  await user.click(screen.getByRole("button", { name: "Enviar arquivo" }));
}

const notice = (): Promise<HTMLElement> => screen.findByRole("dialog", { name: NOTICE });

beforeEach(() => {
  vi.resetAllMocks();
  listAccounts.mockResolvedValue([card]);
  uploadImport.mockResolvedValue(queued);
  acceptAiDocuments.mockResolvedValue(undefined);
});

describe("AiConsentDialog", () => {
  it("o aviso aparece antes do primeiro envio de PDF, e nada é enviado antes do aceite", async () => {
    const user = userEvent.setup();
    renderUpload(false);

    await send(user, PDF);

    const dialog = await notice();
    expect(dialog).toHaveTextContent("lidos por um serviço de IA externo ao Contaí");
    expect(dialog).toHaveTextContent("pode usar os dados para melhorar seus modelos");
    expect(dialog).toHaveTextContent("OFX, CSV ou planilha: esses formatos são lidos sem IA");
    expect(within(dialog).getByRole("button", { name: "Aceitar e enviar" })).toBeInTheDocument();
    expect(uploadImport).not.toHaveBeenCalled();
    expect(acceptAiDocuments).not.toHaveBeenCalled();
  });

  it("a foto de um comprovante também pede o aceite", async () => {
    const user = userEvent.setup();
    renderUpload(false);
    await user.click(await screen.findByRole("radio", { name: "Comprovante" }));

    await send(user, PHOTO, "Foto ou PDF do comprovante");

    expect(await notice()).toBeInTheDocument();
    expect(uploadImport).not.toHaveBeenCalled();
  });

  it("cancelar não envia nada nem registra o aceite", async () => {
    const user = userEvent.setup();
    renderUpload(false);
    await send(user, PDF);

    await user.click(within(await notice()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(uploadImport).not.toHaveBeenCalled();
    expect(acceptAiDocuments).not.toHaveBeenCalled();
    // O arquivo escolhido continua ali: o usuário pode trocar por um OFX ou tentar de novo.
    expect(screen.getByText(/fatura\.pdf/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Andamento da importação" })).toBeNull();
  });

  it("aceitar registra o consentimento e segue com o envio", async () => {
    const user = userEvent.setup();
    renderUpload(false);
    await send(user, PDF);

    await user.click(within(await notice()).getByRole("button", { name: "Aceitar e enviar" }));

    expect(
      await screen.findByRole("heading", { name: "Andamento da importação" }),
    ).toBeInTheDocument();
    expect(acceptAiDocuments).toHaveBeenCalledTimes(1);
    expect(uploadImport).toHaveBeenCalledTimes(1);
    expect(uploadImport).toHaveBeenCalledWith(PDF, "acc-card", "statement");
    // O aceite vem antes do envio.
    expect(acceptAiDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      uploadImport.mock.invocationCallOrder[0] ?? 0,
    );
    expect(queryClient.getQueryData<CurrentUser>(sessionQueryKey)?.ai_documents_consent).toBe(true);
  });

  it("depois do aceite o aviso não aparece de novo", async () => {
    const user = userEvent.setup();
    renderUpload(true);

    await send(user, PDF);

    expect(
      await screen.findByRole("heading", { name: "Andamento da importação" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(acceptAiDocuments).not.toHaveBeenCalled();
    expect(uploadImport).toHaveBeenCalledWith(PDF, "acc-card", "statement");
  });

  it("arquivo lido sem IA não pede o aceite", async () => {
    const user = userEvent.setup();
    renderUpload(false);

    await send(user, OFX);

    expect(
      await screen.findByRole("heading", { name: "Andamento da importação" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(acceptAiDocuments).not.toHaveBeenCalled();
    expect(uploadImport).toHaveBeenCalledWith(OFX, "acc-card", "statement");
  });

  it("se o aceite não pôde ser registrado, o aviso diz o que fazer e nada é enviado", async () => {
    const user = userEvent.setup();
    acceptAiDocuments.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    renderUpload(false);
    await send(user, PDF);

    const dialog = await notice();
    await user.click(within(dialog).getByRole("button", { name: "Aceitar e enviar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor.",
    );
    expect(uploadImport).not.toHaveBeenCalled();
  });

  it("se o servidor diz que falta o aceite, o aviso aparece", async () => {
    const user = userEvent.setup();
    // O perfil em memória diz que o aceite existe; o servidor é quem decide.
    uploadImport.mockRejectedValueOnce(
      new ApiError({ status: 403, code: "ai_consent_required", message: "Aceite o aviso." }),
    );
    renderUpload(true);

    await send(user, PDF);
    await user.click(within(await notice()).getByRole("button", { name: "Aceitar e enviar" }));

    expect(
      await screen.findByRole("heading", { name: "Andamento da importação" }),
    ).toBeInTheDocument();
    expect(acceptAiDocuments).toHaveBeenCalledTimes(1);
    expect(uploadImport).toHaveBeenCalledTimes(2);
  });
});
