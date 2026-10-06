import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import App from "./App";

const failing = vi.hoisted(() => ({ authProvider: false }));

// O AuthProvider de verdade, com uma chave para fazê-lo falhar ao desenhar.
vi.mock("./features/auth/hooks/useAuth", async (importOriginal) => {
  const original = await importOriginal<typeof import("./features/auth/hooks/useAuth")>();
  return {
    ...original,
    AuthProvider: (props: Parameters<typeof original.AuthProvider>[0]) => {
      if (failing.authProvider) throw new Error("Falha de teste no provedor");
      return createElement(original.AuthProvider, props);
    },
  };
});

describe("App", () => {
  beforeEach(() => {
    failing.authProvider = false;
    // Sem cookie de refresh: a API recusa a renovação e o visitante vai para a tela de entrada.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "unauthenticated", message: "Entre de novo." } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sobe com os provedores e leva o visitante sem sessão à tela de entrada", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("Contaí")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/entrar");
  });

  it("um erro em um provedor, fora das rotas, cai na mesma tela de erro", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failing.authProvider = true;

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("Algo deu errado");
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeInTheDocument();
    expect(screen.queryByText("Falha de teste no provedor")).not.toBeInTheDocument();
    silence.mockRestore();
  });
});
