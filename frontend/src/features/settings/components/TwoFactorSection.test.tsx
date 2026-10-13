import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import type { CurrentUser } from "../../auth/types";
import * as settingsService from "../services/settingsService";
import { TwoFactorSection } from "./TwoFactorSection";

vi.mock("../services/settingsService");

const setupTwoFactor = vi.mocked(settingsService.setupTwoFactor);
const enableTwoFactor = vi.mocked(settingsService.enableTwoFactor);

const SECRET = "JBSWY3DPEHPK3PXP";
const CODES = Array.from({ length: 10 }, (_, index) => `code${index}-abcde`);

const userWithout2fa: CurrentUser = {
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
      <ToastProvider>
        <TwoFactorSection user={userWithout2fa} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  setupTwoFactor.mockResolvedValue({
    otpauth_uri: `otpauth://totp/Conta%C3%AD:marina?secret=${SECRET}&issuer=Conta%C3%AD`,
    secret: SECRET,
  });
});

async function startSetup(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Ativar a verificação em duas etapas" }));
  await screen.findByText("1. Instale um aplicativo autenticador");
}

describe("TwoFactorSection", () => {
  it("mostra o QR code e o segredo em texto ao começar a configuração", async () => {
    const user = renderSection();

    await startSetup(user);

    // O QR code é um SVG do tamanho pedido; o segredo aparece em texto, para quem não lê o QR.
    expect(document.querySelector('svg[height="176"]')).not.toBeNull();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it("código errado mostra um erro que diz o que fazer", async () => {
    enableTwoFactor.mockRejectedValue(
      new ApiError({
        status: 401,
        code: "invalid_two_factor_code",
        message: "Código inválido. Confira no app autenticador e tente de novo.",
      }),
    );
    const user = renderSection();
    await startSetup(user);

    await user.type(screen.getByLabelText("Código de 6 dígitos"), "000000");
    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Código inválido");
    // Não avançou para os códigos de recuperação.
    expect(screen.queryByText("code0-abcde")).toBeNull();
  });

  it("código certo ativa e exibe os 10 códigos de recuperação, com o aviso de guardá-los", async () => {
    enableTwoFactor.mockResolvedValue({ recovery_codes: CODES });
    const user = renderSection();
    await startSetup(user);

    await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");
    await user.click(screen.getByRole("button", { name: "Ativar" }));

    expect(await screen.findByText("Pronto! A verificação em duas etapas está ativa.")).toBeVisible();
    expect(screen.getByText(/Guarde estes códigos agora/)).toBeInTheDocument();
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    expect(enableTwoFactor).toHaveBeenCalledWith("123456");
  });
});
