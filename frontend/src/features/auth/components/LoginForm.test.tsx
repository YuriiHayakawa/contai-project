import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";

import { ApiError } from "../../../lib/api-client";
import { AuthProvider, useAuth, type AuthContextValue } from "../hooks/useAuth";
import * as authService from "../services/authService";
import type { CurrentUser, LoginResponse } from "../types";
import { LoginForm } from "./LoginForm";

vi.mock("../services/authService");

const loginService = vi.mocked(authService.login);
const startSession = vi.mocked(authService.startSession);
const resendService = vi.mocked(authService.resendVerification);

const marina: CurrentUser = {
  name: "Marina Duarte",
  email: "marina@exemplo.com",
  status: "active",
  two_factor_enabled: false,
  ai_documents_consent: false,
  deletion_scheduled_at: null,
};
const tokens: LoginResponse = {
  access_token: "token-1",
  token_type: "bearer",
  two_factor_required: false,
  challenge_token: null,
};

let auth: AuthContextValue;

function AuthCapture() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  });
  return null;
}

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthCapture />
        <MemoryRouter>
          <LoginForm />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const emailField = (): HTMLElement => screen.getByRole("textbox", { name: "E-mail" });
const passwordField = (): HTMLElement => screen.getByLabelText("Senha");
const submitButton = (): HTMLElement => screen.getByRole("button", { name: "Entrar" });

async function fill(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(emailField(), "marina@exemplo.com");
  await user.type(passwordField(), "caderneta de contas 42");
}

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError({ status, code, message });
}

beforeEach(() => {
  vi.resetAllMocks();
  // Ao carregar, não há sessão para recuperar.
  vi.mocked(authService.restoreSession).mockResolvedValue(null);
});

describe("LoginForm", () => {
  it("campos vazios: diz o que escrever e não chama o servidor", async () => {
    const user = renderForm();

    await user.click(submitButton());

    expect(await screen.findByText("Escreva seu e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Escreva sua senha.")).toBeInTheDocument();
    expect(emailField()).toBeInvalid();
    expect(passwordField()).toBeInvalid();
    expect(loginService).not.toHaveBeenCalled();
  });

  it("entra: envia as credenciais, mostra carregando e começa a sessão", async () => {
    let finish: (value: LoginResponse) => void = () => undefined;
    loginService.mockReturnValue(
      new Promise<LoginResponse>((resolve) => {
        finish = resolve;
      }),
    );
    startSession.mockResolvedValue(marina);
    const user = renderForm();
    await fill(user);

    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toHaveAttribute("aria-busy", "true"));
    expect(loginService).toHaveBeenCalledWith({
      email: "marina@exemplo.com",
      password: "caderneta de contas 42",
    });
    await user.click(submitButton());
    expect(loginService).toHaveBeenCalledTimes(1);

    finish(tokens);

    await waitFor(() => expect(auth.status).toBe("authenticated"));
    expect(startSession).toHaveBeenCalledWith("token-1");
    expect(auth.user).toEqual(marina);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("e-mail ou senha errados: mostra a mensagem genérica do servidor", async () => {
    loginService.mockRejectedValue(
      apiError(
        401,
        "invalid_credentials",
        "E-mail ou senha incorretos. Confira os dois e tente de novo.",
      ),
    );
    const user = renderForm();
    await fill(user);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "E-mail ou senha incorretos. Confira os dois e tente de novo.",
    );
    expect(submitButton()).not.toHaveAttribute("aria-busy");
    expect(auth.status).toBe("anonymous");
  });

  it("entrada bloqueada: explica e aponta o caminho da nova senha", async () => {
    loginService.mockRejectedValue(
      apiError(
        423,
        "account_locked",
        "Por segurança, a entrada nesta conta foi bloqueada depois de várias tentativas erradas. " +
          "Tente de novo em alguns minutos ou crie uma nova senha.",
      ),
    );
    const user = renderForm();
    await fill(user);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("crie uma nova senha");
    expect(screen.getByRole("link", { name: "Esqueci minha senha" })).toHaveAttribute(
      "href",
      "/esqueci-a-senha",
    );
  });

  it("e-mail ainda não confirmado: oferece reenviar o link, para o e-mail digitado", async () => {
    loginService.mockRejectedValue(
      apiError(
        403,
        "email_not_verified",
        "Confirme seu e-mail para continuar. Abra o link que enviamos para você ou peça um novo.",
      ),
    );
    resendService.mockResolvedValue({ message: "Se este e-mail tiver uma conta, enviamos." });
    const user = renderForm();
    await fill(user);
    await user.click(submitButton());

    expect(await screen.findByText(/Confirme seu e-mail para continuar/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reenviar o link" }));

    expect(await screen.findByText("Se este e-mail tiver uma conta, enviamos.")).toBeVisible();
    expect(resendService).toHaveBeenCalledWith("marina@exemplo.com", expect.anything());
  });

  it("falha de rede: mensagem que diz o que fazer, sem texto técnico", async () => {
    loginService.mockRejectedValue(
      apiError(
        0,
        "network_error",
        "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      ),
    );
    const user = renderForm();
    await fill(user);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confira sua conexão e tente de novo.",
    );
  });

  it("a senha pode ser mostrada e ocultada", async () => {
    const user = renderForm();
    await user.type(passwordField(), "segredo");

    await user.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(passwordField()).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(passwordField()).toHaveAttribute("type", "password");
  });
});
