import { render, screen } from "@testing-library/react";

import App from "./App";

describe("App", () => {
  beforeEach(() => {
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
});
