import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import type { CurrentUser } from "../../auth/types";
import * as settingsService from "../services/settingsService";
import { DeleteAccountSection } from "./DeleteAccountSection";

vi.mock("../services/settingsService");

// A seção usa a sessão só para sair depois do pedido; aqui basta um `signOut` de mentira.
const signOut = vi.fn();
vi.mock("../../auth/hooks/useAuth", () => ({
  useAuth: () => ({ signOut }),
  sessionQueryKey: ["auth", "session"],
}));

const requestDeletion = vi.mocked(settingsService.requestDeletion);

const user: CurrentUser = {
  name: "Marina",
  email: "marina@exemplo.com",
  status: "active",
  two_factor_enabled: false,
  ai_documents_consent: false,
  deletion_scheduled_at: null,
};

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <DeleteAccountSection user={user} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function openDialog(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(screen.getByRole("button", { name: "Excluir minha conta" }));
  return within(await screen.findByRole("alertdialog"));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DeleteAccountSection", () => {
  it("mostra o aviso do prazo de 7 dias e o convite a baixar os dados", () => {
    renderSection();

    expect(screen.getByText(/7 dias/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "baixar seus dados" })).toBeInTheDocument();
  });

  it("pede a senha e a confirmação antes de enviar o pedido", async () => {
    const actor = renderSection();
    const dialog = await openDialog(actor);

    // Abrir o diálogo ainda não exclui nada.
    expect(requestDeletion).not.toHaveBeenCalled();
    expect(dialog.getByLabelText("Sua senha")).toBeInTheDocument();

    // Sem a senha, o pedido não sai.
    await actor.click(dialog.getByRole("button", { name: "Excluir a conta" }));
    expect(await dialog.findByText("Informe sua senha para confirmar.")).toBeInTheDocument();
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it("senha errada mostra o erro sem fechar o diálogo", async () => {
    requestDeletion.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "incorrect_password",
        message: "Senha incorreta. Confira e tente de novo.",
        details: { fields: { password: "Senha incorreta. Confira e tente de novo." } },
      }),
    );
    const actor = renderSection();
    const dialog = await openDialog(actor);

    await actor.type(dialog.getByLabelText("Sua senha"), "senha errada");
    await actor.click(dialog.getByRole("button", { name: "Excluir a conta" }));

    expect(await screen.findByText(/Senha incorreta/)).toBeInTheDocument();
    expect(requestDeletion).toHaveBeenCalledWith({ password: "senha errada", code: undefined });
    // O diálogo continua aberto e não saímos da conta.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });
});
