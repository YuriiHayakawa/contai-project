import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuth, type AuthContextValue } from "./features/auth/hooks/useAuth";
import type { CurrentUser } from "./features/auth/types";
import { SESSION_EXPIRED_MESSAGE, api, setAccessToken } from "./lib/api-client";
import { paths, returnPathFrom } from "./lib/paths";
import { createQueryClient } from "./lib/query-client";
import { routes } from "./router";

const marina: CurrentUser = {
  name: "Marina Duarte",
  email: "marina@exemplo.com",
  status: "active",
  two_factor_enabled: false,
  ai_documents_consent: false,
  deletion_scheduled_at: null,
};

type Server = "session" | "no-session" | "offline";

let server: Server;
let auth: AuthContextValue;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const unauthenticated = (): Response =>
  json(401, { error: { code: "unauthenticated", message: "Entre de novo." }, request_id: "r" });

/** API falsa: com sessão, o refresh entrega um token e as rotas autenticadas respondem. */
function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (server === "offline") return Promise.reject(new TypeError("Failed to fetch"));
  if (server === "no-session") return Promise.resolve(unauthenticated());
  if (url === "/api/v1/auth/refresh") return Promise.resolve(json(200, { access_token: "t-1" }));
  const authorized = new Headers(init.headers).has("Authorization");
  if (url === "/api/v1/users/me" && authorized) return Promise.resolve(json(200, marina));
  return Promise.resolve(unauthenticated());
}

function AuthCapture() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  });
  return null;
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <AuthProvider>
          <AuthCapture />
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** Sem CSS nos testes, as duas navegações aparecem juntas; cada uma é conferida pelo nome. */
const sidebar = (): HTMLElement => {
  const [first] = screen.getAllByRole("navigation", { name: "Principal" });
  if (!first) throw new Error("A barra lateral não foi desenhada");
  return first;
};
const bottomNav = (): HTMLElement => {
  const second = screen.getAllByRole("navigation", { name: "Principal" })[1];
  if (!second) throw new Error("A barra inferior não foi desenhada");
  return second;
};

beforeEach(() => {
  server = "session";
  setAccessToken(null);
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RequireAuth", () => {
  it("sem sessão, leva à tela de entrada guardando a rota de origem, sem aviso de expiração", async () => {
    server = "no-session";
    const router = renderApp("/lancamentos?q=padaria");

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(paths.login);
    expect(router.state.location.state).toEqual({ from: "/lancamentos?q=padaria" });
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).not.toBeInTheDocument();
  });

  it("mostra o carregamento enquanto o refresh silencioso não responde", () => {
    renderApp(paths.home);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
  });

  it("com o cookie de refresh válido, recupera a sessão e mostra a casca do app", async () => {
    renderApp(paths.transactions);

    expect(await screen.findByRole("heading", { name: "Lançamentos", level: 1 })).toBeVisible();
    expect(within(sidebar()).getByText("Marina Duarte")).toBeInTheDocument();
    expect(auth.status).toBe("authenticated");
    expect(auth.user).toEqual(marina);
  });

  it("quando o servidor não responde, oferece tentar de novo em vez de derrubar a sessão", async () => {
    const user = userEvent.setup();
    server = "offline";
    renderApp(paths.home);

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível abrir o Contaí");
    expect(auth.status).toBe("unavailable");

    server = "session";
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByRole("heading", { name: "Início", level: 1 })).toBeInTheDocument();
  });

  it("endereço desconhecido mostra página não encontrada", async () => {
    renderApp("/nao-existe");

    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });
});

describe("sessão expirada no meio do uso", () => {
  it("leva à tela de entrada com a mensagem e volta à rota de origem depois do login", async () => {
    const router = renderApp(paths.accounts);
    await screen.findByRole("heading", { name: "Contas", level: 1 });

    // O servidor passa a recusar o token e o refresh: é o que um serviço encontraria.
    server = "no-session";
    await act(async () => {
      await expect(api.post("/transactions", { amount_cents: 4590 })).rejects.toMatchObject({
        code: "session_expired",
      });
    });

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sua sessão expirou. Entre de novo para continuar.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: paths.accounts });
    expect(auth.user).toBeNull();

    server = "session";
    await act(() => auth.signIn("t-2"));

    expect(await screen.findByRole("heading", { name: "Contas", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(paths.accounts);
    expect(auth.sessionExpired).toBe(false);
  });

  it("sair da conta não mostra o aviso de sessão expirada", async () => {
    renderApp(paths.home);
    await screen.findByRole("heading", { name: "Início", level: 1 });

    act(() => auth.signOut());

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).not.toBeInTheDocument();
  });
});

describe("navegação", () => {
  it("marca a página atual com aria-current nas duas navegações", async () => {
    renderApp(paths.transactions);
    await screen.findByRole("heading", { name: "Lançamentos", level: 1 });

    for (const nav of [sidebar(), bottomNav()]) {
      expect(within(nav).getByRole("link", { name: "Lançamentos" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(within(nav).getByRole("link", { name: "Início" })).not.toHaveAttribute("aria-current");
    }
  });

  it("a barra inferior tem Início, Lançamentos, Lançar, Assistente e Mais", async () => {
    renderApp(paths.home);
    await screen.findByRole("heading", { name: "Início", level: 1 });

    const items = Array.from(bottomNav().querySelectorAll("a, button")).map(
      (item) => item.getAttribute("aria-label") ?? item.textContent,
    );

    expect(items).toEqual(["Início", "Lançamentos", "Lançar", "Assistente", "Mais"]);
  });

  it('"Mais" abre a folha com Contas, Categorias, Importações e Configurações', async () => {
    const user = userEvent.setup();
    const router = renderApp(paths.home);
    await screen.findByRole("heading", { name: "Início", level: 1 });

    await user.click(within(bottomNav()).getByRole("button", { name: "Mais" }));

    const sheet = screen.getByRole("dialog", { name: "Mais" });
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Contas", "Categorias", "Importações", "Configurações"]);

    await user.click(within(sheet).getByRole("link", { name: "Categorias" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(paths.categories);
  });

  it('"Lançar" e "Novo lançamento" disparam a mesma ação', async () => {
    const user = userEvent.setup();
    renderApp(paths.home);
    await screen.findByRole("heading", { name: "Início", level: 1 });

    await user.click(within(bottomNav()).getByRole("button", { name: "Lançar" }));
    await user.click(within(sidebar()).getByRole("button", { name: "Novo lançamento" }));

    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});

describe("returnPathFrom", () => {
  it("devolve a rota de origem levada pelo guard", () => {
    expect(returnPathFrom({ from: "/contas?arquivadas=1" })).toBe("/contas?arquivadas=1");
  });

  it("vai para o início sem origem, ou quando a origem é a própria tela de entrada", () => {
    expect(returnPathFrom(null)).toBe(paths.home);
    expect(returnPathFrom({})).toBe(paths.home);
    expect(returnPathFrom({ from: paths.login })).toBe(paths.home);
  });

  it("recusa endereço de fora do app", () => {
    expect(returnPathFrom({ from: "https://exemplo.com" })).toBe(paths.home);
    expect(returnPathFrom({ from: "//exemplo.com" })).toBe(paths.home);
    expect(returnPathFrom({ from: 42 })).toBe(paths.home);
  });
});
