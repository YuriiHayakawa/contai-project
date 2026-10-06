import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { ApiError } from "../../../lib/api-client";
import * as authService from "../services/authService";
import type { MessageResponse } from "../types";
import { RegisterForm } from "./RegisterForm";

vi.mock("../services/authService");

const registerService = vi.mocked(authService.register);

const accepted: MessageResponse = { message: "Quase lá! Enviamos um e-mail para você." };

function renderForm() {
  const onRegistered = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RegisterForm onRegistered={onRegistered} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onRegistered, user: userEvent.setup() };
}

const nameField = (): HTMLElement => screen.getByRole("textbox", { name: "Nome" });
const emailField = (): HTMLElement => screen.getByRole("textbox", { name: "E-mail" });
const passwordField = (): HTMLElement => screen.getByLabelText("Senha");
const policyCheckbox = (): HTMLElement =>
  screen.getByRole("checkbox", { name: /Li e aceito a política de privacidade/ });
const submitButton = (): HTMLElement => screen.getByRole("button", { name: "Criar conta" });

async function fillValid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(nameField(), "Marina Duarte");
  await user.type(emailField(), "marina@exemplo.com");
  await user.type(passwordField(), "caderneta de contas 42");
}

beforeEach(() => {
  registerService.mockReset();
});

describe("RegisterForm", () => {
  it("campos vazios: cada mensagem diz o que fazer, e nada é enviado", async () => {
    const { user, onRegistered } = renderForm();

    await user.click(submitButton());

    expect(await screen.findByText("Escreva seu nome.")).toBeInTheDocument();
    expect(screen.getByText("Escreva seu e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Use uma senha com pelo menos 8 caracteres.")).toBeInTheDocument();
    expect(nameField()).toBeInvalid();
    expect(nameField()).toHaveAccessibleDescription("Escreva seu nome.");
    expect(registerService).not.toHaveBeenCalled();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("e-mail incompleto e senha curta são recusados com orientação", async () => {
    const { user } = renderForm();
    await user.type(nameField(), "Marina");
    await user.type(emailField(), "marina@exemplo");
    await user.type(passwordField(), "curta");

    await user.click(submitButton());

    expect(
      await screen.findByText("Escreva o e-mail completo, como nome@exemplo.com."),
    ).toBeInTheDocument();
    expect(passwordField()).toHaveAccessibleDescription(
      expect.stringContaining("Use uma senha com pelo menos 8 caracteres."),
    );
    expect(registerService).not.toHaveBeenCalled();
  });

  it("sem aceitar a política de privacidade, o cadastro não é enviado", async () => {
    const { user, onRegistered } = renderForm();
    await fillValid(user);

    await user.click(submitButton());

    expect(
      await screen.findByText("Para criar a conta, é preciso aceitar a política de privacidade."),
    ).toBeInTheDocument();
    expect(policyCheckbox()).toBeInvalid();
    expect(registerService).not.toHaveBeenCalled();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("a política de privacidade abre por um link, sem sair do formulário", () => {
    renderForm();

    const link = screen.getByRole("link", { name: "política de privacidade" });

    expect(link).toHaveAttribute("href", "/privacidade");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("dados válidos e política aceita: envia, mostra carregando e avisa quem chamou", async () => {
    let finish: (value: MessageResponse) => void = () => undefined;
    registerService.mockReturnValue(
      new Promise<MessageResponse>((resolve) => {
        finish = resolve;
      }),
    );
    const { user, onRegistered } = renderForm();
    await fillValid(user);
    await user.click(policyCheckbox());

    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toHaveAttribute("aria-busy", "true"));
    expect(registerService).toHaveBeenCalledWith(
      {
        name: "Marina Duarte",
        email: "marina@exemplo.com",
        password: "caderneta de contas 42",
        accept_privacy_policy: true,
      },
      expect.anything(),
    );
    // Enquanto carrega, um segundo clique não envia de novo.
    await user.click(submitButton());
    expect(registerService).toHaveBeenCalledTimes(1);
    expect(onRegistered).not.toHaveBeenCalled();

    finish(accepted);

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith("marina@exemplo.com"));
    expect(submitButton()).not.toHaveAttribute("aria-busy");
  });

  it("tira espaços do nome e do e-mail antes de enviar", async () => {
    registerService.mockResolvedValue(accepted);
    const { user, onRegistered } = renderForm();
    await user.type(nameField(), "  Marina  ");
    await user.type(emailField(), " marina@exemplo.com ");
    await user.type(passwordField(), "caderneta de contas 42");
    await user.click(policyCheckbox());

    await user.click(submitButton());

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith("marina@exemplo.com"));
    expect(registerService.mock.calls[0]?.[0]).toMatchObject({
      name: "Marina",
      email: "marina@exemplo.com",
    });
  });

  it("senha recusada pelo servidor aparece junto do campo, com a orientação dele", async () => {
    const message = "Essa senha é muito comum e fácil de adivinhar. Escolha outra.";
    registerService.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "weak_password",
        message,
        details: { fields: { password: message } },
      }),
    );
    const { user, onRegistered } = renderForm();
    await user.type(nameField(), "Marina");
    await user.type(emailField(), "marina@exemplo.com");
    await user.type(passwordField(), "senha123");
    await user.click(policyCheckbox());

    await user.click(submitButton());

    await waitFor(() => expect(passwordField()).toBeInvalid());
    expect(passwordField()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("falha que não é de um campo aparece em um aviso que diz o que fazer", async () => {
    registerService.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "rate_limited",
        message: "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.",
      }),
    );
    const { user } = renderForm();
    await fillValid(user);
    await user.click(policyCheckbox());

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.",
    );
  });

  it("erro que não veio da API não mostra texto técnico", async () => {
    registerService.mockRejectedValue(new TypeError("Cannot read properties of undefined"));
    const { user } = renderForm();
    await fillValid(user);
    await user.click(policyCheckbox());

    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Tente de novo em alguns instantes.");
    expect(alert).not.toHaveTextContent("Cannot read");
  });
});
