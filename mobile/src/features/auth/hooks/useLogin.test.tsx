import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { createTestQueryClient } from "@/test-utils";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api-client";
import { getAccessToken, readRefreshToken } from "@/lib/session";

import { readPendingChallenge, setPendingChallenge } from "../challenge";
import { LoginForm } from "../components/LoginForm";
import { TwoFactorForm } from "../components/TwoFactorForm";
import * as authService from "../services/auth";
import { SessionProvider, useSession } from "../SessionProvider";

jest.mock("../services/auth");
jest.mock("@/lib/config", () => ({
  getConfig: () => ({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null }),
}));

const login = jest.mocked(authService.login);
const loginTwoFactor = jest.mocked(authService.loginTwoFactor);

const TOKENS = { access_token: "access", refresh_token: "sessao.1", token_type: "bearer" as const };

function SessionStatus() {
  return useSession().status === "signedIn" ? <Text>dentro</Text> : null;
}

async function renderWithSession(children: ReactNode) {
  const queryClient = createTestQueryClient();
  await render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          {children}
          <SessionStatus />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("E-mail"), "ana@exemplo.com");
  await user.type(screen.getByLabelText("Senha"), "uma frase de teste");
  await user.press(screen.getByRole("button", { name: "Entrar" }));
}

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError({ status, code, message });
}

beforeEach(() => {
  // Só os mocks do serviço: o Keychain simulado do jest.setup continua funcionando.
  login.mockReset();
  loginTwoFactor.mockReset();
  setPendingChallenge(null);
});

describe("entrar no app", () => {
  it("sem duas etapas, grava a sessão no aparelho", async () => {
    login.mockResolvedValue({ ...TOKENS, two_factor_required: false, challenge_token: null });
    const onTwoFactor = jest.fn();
    const user = await renderWithSession(<LoginForm onTwoFactor={onTwoFactor} />);

    await fillAndSubmit(user);

    expect(await screen.findByText("dentro")).toBeOnTheScreen();
    expect(login).toHaveBeenCalledWith({
      email: "ana@exemplo.com",
      password: "uma frase de teste",
    });
    expect(getAccessToken()).toBe("access");
    expect(await readRefreshToken()).toBe("sessao.1");
    expect(onTwoFactor).not.toHaveBeenCalled();
  });

  it("confere os campos antes de chamar a API", async () => {
    const user = await renderWithSession(<LoginForm onTwoFactor={jest.fn()} />);

    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Escreva seu e-mail.")).toBeOnTheScreen();
    expect(screen.getByText("Escreva sua senha.")).toBeOnTheScreen();
    expect(login).not.toHaveBeenCalled();
  });

  it("com duas etapas, guarda o desafio e leva à tela do código", async () => {
    login.mockResolvedValue({
      access_token: null,
      refresh_token: null,
      token_type: null,
      two_factor_required: true,
      challenge_token: "desafio",
    });
    const onTwoFactor = jest.fn();
    const user = await renderWithSession(<LoginForm onTwoFactor={onTwoFactor} />);

    await fillAndSubmit(user);

    await waitFor(() => expect(onTwoFactor).toHaveBeenCalled());
    expect(readPendingChallenge()).toBe("desafio");
    expect(screen.queryByText("dentro")).not.toBeOnTheScreen();
  });

  it.each([
    [401, "invalid_credentials", "E-mail ou senha incorretos. Confira os dois e tente de novo."],
    [403, "email_not_verified", "Confirme seu e-mail para continuar. Abra o link que enviamos."],
    [423, "account_locked", "Por segurança, a entrada nesta conta foi bloqueada."],
  ])("mostra a mensagem do site para %i %s", async (status, code, message) => {
    login.mockRejectedValue(apiError(status, code, message));
    const user = await renderWithSession(<LoginForm onTwoFactor={jest.fn()} />);

    await fillAndSubmit(user);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByText("dentro")).not.toBeOnTheScreen();
  });
});

describe("segunda etapa no app", () => {
  it("aceita o código do aplicativo", async () => {
    setPendingChallenge("desafio");
    loginTwoFactor.mockResolvedValue(TOKENS);
    const user = await renderWithSession(<TwoFactorForm onChallengeMissing={jest.fn()} />);

    await user.type(screen.getByLabelText("Código do aplicativo"), "123456");
    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("dentro")).toBeOnTheScreen();
    expect(loginTwoFactor).toHaveBeenCalledWith({ challenge_token: "desafio", code: "123456" });
    expect(readPendingChallenge()).toBeNull();
  });

  it("aceita um código de recuperação", async () => {
    setPendingChallenge("desafio");
    loginTwoFactor.mockResolvedValue(TOKENS);
    const user = await renderWithSession(<TwoFactorForm onChallengeMissing={jest.fn()} />);

    await user.press(
      screen.getByRole("button", {
        name: "Não estou com o celular: usar um código de recuperação",
      }),
    );
    await user.type(screen.getByLabelText("Código de recuperação"), "abcde-fghij");
    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("dentro")).toBeOnTheScreen();
    expect(loginTwoFactor).toHaveBeenCalledWith({
      challenge_token: "desafio",
      recovery_code: "abcde-fghij",
    });
  });

  it("código errado mostra a mensagem da API e deixa tentar de novo", async () => {
    setPendingChallenge("desafio");
    loginTwoFactor.mockRejectedValue(
      apiError(401, "invalid_two_factor_code", "Código inválido. Confira no app autenticador."),
    );
    const user = await renderWithSession(<TwoFactorForm onChallengeMissing={jest.fn()} />);

    await user.type(screen.getByLabelText("Código do aplicativo"), "000000");
    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText("Código inválido. Confira no app autenticador."),
    ).toBeOnTheScreen();
    expect(readPendingChallenge()).toBe("desafio");
  });

  it("desafio vencido pede para entrar de novo", async () => {
    setPendingChallenge("desafio");
    loginTwoFactor.mockRejectedValue(apiError(401, "unauthenticated", "Entre de novo."));
    const user = await renderWithSession(<TwoFactorForm onChallengeMissing={jest.fn()} />);

    await user.type(screen.getByLabelText("Código do aplicativo"), "123456");
    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText(
        "A entrada demorou demais. Volte e entre de novo com e-mail e senha.",
      ),
    ).toBeOnTheScreen();
  });

  it("sem desafio guardado, volta para a entrada", async () => {
    const onChallengeMissing = jest.fn();
    await renderWithSession(<TwoFactorForm onChallengeMissing={onChallengeMissing} />);

    expect(onChallengeMissing).toHaveBeenCalled();
  });
});
