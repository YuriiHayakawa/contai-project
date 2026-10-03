import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuth, type AuthContextValue } from "./features/auth/hooks/useAuth";
import type { CurrentUser } from "./features/auth/types";
import { SESSION_EXPIRED_MESSAGE, api, setAccessToken } from "./lib/api-client";
import { monthRange, yearMonthOf } from "./lib/dates";
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

// Marina ainda não tem lançamentos: a tela inicial mostra as boas-vindas.
const HOME_HEADING = "Boas-vindas, Marina";

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

interface RecordedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  authorized: boolean;
}

let requests: RecordedRequest[];

const requestsTo = (path: string): RecordedRequest[] =>
  requests.filter((request) => request.path === path);

const invalidToken = (): Response =>
  json(400, {
    error: {
      code: "invalid_or_expired_token",
      message: "Este link não vale mais. Peça um novo link e use o mais recente.",
    },
    request_id: "r",
  });

/** Rotas públicas de acesso da API falsa. Devolve `null` para as demais. */
function fakeAuthRoute(path: string, body: Record<string, unknown> | null): Response | null {
  switch (path) {
    case "/auth/register":
      return json(202, { message: "Quase lá! Enviamos um e-mail para você." });
    case "/auth/resend-verification":
      return json(202, { message: "Se houver conta esperando confirmação, enviamos o link." });
    case "/auth/password/forgot":
      return json(202, { message: "Se este e-mail tiver uma conta, enviamos um link." });
    case "/auth/verify-email":
    case "/auth/password/reset":
      return body?.token === "valido" ? new Response(null, { status: 204 }) : invalidToken();
    case "/auth/login":
      if (body?.password !== "senha certa") {
        return json(401, {
          error: { code: "invalid_credentials", message: "E-mail ou senha incorretos." },
          request_id: "r",
        });
      }
      server = "session";
      return json(200, { access_token: "t-login", token_type: "bearer" });
    case "/auth/logout":
      server = "no-session";
      return new Response(null, { status: 204 });
    default:
      return null;
  }
}

/** Dados de uma conta recém-criada: sem contas, sem lançamentos e com uma categoria pronta. */
function fakeDataRoute(path: string): Response | null {
  const [route] = path.split("?");
  switch (route) {
    case "/accounts":
      return json(200, { items: [] });
    case "/categories":
      return json(200, {
        expense: [
          {
            id: "cat-outros",
            name: "Outros",
            kind: "expense",
            parent_id: null,
            icon: "shapes",
            color: "ardosia",
            is_fallback: true,
            archived: false,
            children: [],
          },
        ],
        income: [],
      });
    case "/transactions":
      return json(200, { items: [], next_cursor: null, total_count: 0 });
    case "/dashboard/summary":
      return json(200, {
        month: yearMonthOf(),
        income_cents: 0,
        expense_cents: 0,
        net_cents: 0,
        accounts: [],
      });
    case "/dashboard/categories":
      return json(200, { month: yearMonthOf(), total_cents: 0, items: [] });
    case "/dashboard/trend":
      return json(200, { items: [] });
    case "/dashboard/cards":
      return json(200, { items: [] });
    case "/dashboard/top-expenses":
      return json(200, { month: yearMonthOf(), items: [] });
    default:
      return null;
  }
}

/** API falsa: com sessão, o refresh entrega um token e as rotas autenticadas respondem. */
function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  const path = url.replace("/api/v1", "");
  const body =
    typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  requests.push({
    method: init.method ?? "GET",
    path,
    body,
    authorized: new Headers(init.headers).has("Authorization"),
  });
  if (server === "offline") return Promise.reject(new TypeError("Failed to fetch"));
  const authResponse = fakeAuthRoute(path, body);
  if (authResponse) return Promise.resolve(authResponse);
  if (server === "no-session") return Promise.resolve(unauthenticated());
  if (url === "/api/v1/auth/refresh") return Promise.resolve(json(200, { access_token: "t-1" }));
  const authorized = new Headers(init.headers).has("Authorization");
  if (!authorized) return Promise.resolve(unauthenticated());
  if (url === "/api/v1/users/me") return Promise.resolve(json(200, marina));
  const data = fakeDataRoute(path);
  return Promise.resolve(data ?? unauthenticated());
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
  requests = [];
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

    expect(
      await screen.findByRole("heading", { name: HOME_HEADING, level: 1 }),
    ).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

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
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

    const items = Array.from(bottomNav().querySelectorAll("a, button")).map(
      (item) => item.getAttribute("aria-label") ?? item.textContent,
    );

    expect(items).toEqual(["Início", "Lançamentos", "Lançar", "Assistente", "Mais"]);
  });

  it('"Mais" abre a folha com Contas, Categorias, Importações e Configurações', async () => {
    const user = userEvent.setup();
    const router = renderApp(paths.home);
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

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

  it('"Lançar" e "Novo lançamento" abrem a mesma folha de novo lançamento', async () => {
    const user = userEvent.setup();
    renderApp(paths.home);
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

    await user.click(within(bottomNav()).getByRole("button", { name: "Lançar" }));
    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    await user.click(within(sheet).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(sidebar()).getByRole("button", { name: "Novo lançamento" }));

    expect(await screen.findByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
  });

  it("sem conta cadastrada, a folha de lançamento leva ao cadastro de conta", async () => {
    const user = userEvent.setup();
    const router = renderApp(paths.transactions);
    await screen.findByRole("heading", { name: /^Nada lançado em / });

    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Lançar" }));
    const sheet = await screen.findByRole("dialog", { name: "Novo lançamento" });
    expect(
      within(sheet).getByRole("heading", { name: "Cadastre uma conta primeiro" }),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Cadastrar conta" }));

    expect(await screen.findByRole("heading", { name: "Contas", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(paths.accounts);
    expect(
      screen.getByRole("heading", { name: "Cadastre sua primeira conta" }),
    ).toBeInTheDocument();
  });

  it("a tela inicial de quem não tem lançamentos mostra os primeiros passos", async () => {
    const user = userEvent.setup();
    const router = renderApp(paths.home);

    expect(await screen.findByRole("heading", { name: HOME_HEADING, level: 1 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Comece por aqui" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { current: "step" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Para onde foi o dinheiro" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cadastrar conta" }));

    expect(await screen.findByRole("heading", { name: "Contas", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(paths.accounts);
  });

  it("as telas de contas, categorias e lançamentos estão nas rotas", async () => {
    const router = renderApp(paths.categories);

    expect(await screen.findByRole("heading", { name: "Categorias", level: 1 })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Nova categoria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outros" })).toBeInTheDocument();

    await act(() => router.navigate("/lancamentos?q=padaria"));

    expect(await screen.findByRole("searchbox", { name: "Buscar lançamentos" })).toHaveValue(
      "padaria",
    );
    expect(
      await screen.findByRole("heading", { name: "Nenhum lançamento encontrado" }),
    ).toBeInTheDocument();
    // Sem período no endereço, a busca vale para o mês atual.
    const { from, to } = monthRange(yearMonthOf());
    expect(requestsTo(`/transactions?q=padaria&from=${from}&to=${to}`)).not.toHaveLength(0);
  });
});

describe("criar conta e confirmar o e-mail", () => {
  it("depois do cadastro, pede a confirmação mostrando o e-mail informado", async () => {
    const user = userEvent.setup();
    server = "no-session";
    const router = renderApp(paths.register);

    await user.type(await screen.findByRole("textbox", { name: "Nome" }), "Marina Duarte");
    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "marina@exemplo.com");
    await user.type(screen.getByLabelText("Senha"), "caderneta de contas 42");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/confirmar-email");
    expect(screen.getByText("marina@exemplo.com")).toBeInTheDocument();
    // O reenvio já vem com o e-mail do cadastro.
    expect(screen.getByRole("textbox", { name: "E-mail" })).toHaveValue("marina@exemplo.com");

    await user.click(screen.getByRole("button", { name: "Enviar novo link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("enviamos o link");
    expect(requestsTo("/auth/resend-verification")[0]?.body).toEqual({
      email: "marina@exemplo.com",
    });
  });

  it("abrir o link do e-mail não confirma nada: só mostra o botão", async () => {
    server = "no-session";
    renderApp("/confirmar-email?token=valido");

    expect(await screen.findByRole("button", { name: "Confirmar meu e-mail" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Falta só um passo" })).toBeVisible();
    // Um verificador automático que só abre o endereço não gasta o link de uso único.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestsTo("/auth/verify-email")).toHaveLength(0);
  });

  it("o clique em Confirmar meu e-mail confirma com um único pedido e leva à entrada", async () => {
    const user = userEvent.setup();
    server = "no-session";
    const router = renderApp("/confirmar-email?token=valido");

    await user.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));

    expect(await screen.findByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
    expect(requestsTo("/auth/verify-email")).toEqual([
      { method: "POST", path: "/auth/verify-email", body: { token: "valido" }, authorized: false },
    ]);

    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeVisible();
    expect(router.state.location.pathname).toBe(paths.login);
  });

  it("link usado ou vencido: explica e oferece pedir outro", async () => {
    const user = userEvent.setup();
    server = "no-session";
    renderApp("/confirmar-email?token=usado");

    await user.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Peça um novo link");
    expect(screen.getByRole("heading", { name: "Não deu para confirmar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar novo link" })).toBeInTheDocument();
  });
});

describe("entrar e sair", () => {
  async function signIn(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(await screen.findByRole("textbox", { name: "E-mail" }), "marina@exemplo.com");
    await user.type(screen.getByLabelText("Senha"), password);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
  }

  it("entra pelo formulário e volta para a rota que tinha pedido", async () => {
    const user = userEvent.setup();
    server = "no-session";
    const router = renderApp(paths.accounts);

    await signIn(user, "senha certa");

    expect(await screen.findByRole("heading", { name: "Contas", level: 1 })).toBeVisible();
    expect(router.state.location.pathname).toBe(paths.accounts);
    expect(auth.user).toEqual(marina);
  });

  it("senha errada fica na tela de entrada, com a mensagem", async () => {
    const user = userEvent.setup();
    server = "no-session";
    const router = renderApp(paths.login);

    await signIn(user, "senha errada");

    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
    expect(router.state.location.pathname).toBe(paths.login);
  });

  it('"Sair" na barra lateral encerra a sessão no servidor e leva à entrada, sem aviso', async () => {
    const user = userEvent.setup();
    const router = renderApp(paths.home);
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

    await user.click(within(sidebar()).getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeVisible();
    expect(router.state.location.pathname).toBe(paths.login);
    expect(requestsTo("/auth/logout")).toEqual([
      { method: "POST", path: "/auth/logout", body: null, authorized: true },
    ]);
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).not.toBeInTheDocument();
    expect(auth.user).toBeNull();
  });

  it('no celular, "Sair" fica no fim da folha "Mais"', async () => {
    const user = userEvent.setup();
    renderApp(paths.home);
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });

    await user.click(within(bottomNav()).getByRole("button", { name: "Mais" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Mais" })).getByRole("button", { name: "Sair" }),
    );

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeVisible();
    expect(requestsTo("/auth/logout")).toHaveLength(1);
  });

  it("mesmo sem resposta do servidor, sair encerra a sessão neste aparelho", async () => {
    const user = userEvent.setup();
    renderApp(paths.home);
    await screen.findByRole("heading", { name: HOME_HEADING, level: 1 });
    server = "offline";

    await user.click(within(sidebar()).getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeVisible();
    expect(auth.user).toBeNull();
  });

  it.each([paths.login, paths.register, paths.forgotPassword])(
    "quem já está conectado não vê %s: segue para o início",
    async (path) => {
      const router = renderApp(path);

      expect(await screen.findByRole("heading", { name: HOME_HEADING, level: 1 })).toBeVisible();
      expect(router.state.location.pathname).toBe(paths.home);
    },
  );
});

describe("redefinir a senha", () => {
  it("pede o link e mostra a mesma resposta genérica do servidor", async () => {
    const user = userEvent.setup();
    server = "no-session";
    renderApp(paths.forgotPassword);

    await user.type(await screen.findByRole("textbox", { name: "E-mail" }), "marina@exemplo.com");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(await screen.findByRole("heading", { name: "Confira seu e-mail" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Se este e-mail tiver uma conta, enviamos um link.",
    );
    expect(requestsTo("/auth/password/forgot")[0]?.body).toEqual({ email: "marina@exemplo.com" });
  });

  it("o link do e-mail abre o formulário, salva a nova senha e leva à entrada", async () => {
    const user = userEvent.setup();
    server = "no-session";
    const router = renderApp("/redefinir-senha?token=valido");

    await user.type(await screen.findByLabelText("Nova senha"), "outra frase bem comprida");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByRole("heading", { name: "Senha alterada" })).toBeVisible();
    expect(requestsTo("/auth/password/reset")[0]?.body).toEqual({
      token: "valido",
      new_password: "outra frase bem comprida",
    });

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeVisible();
    expect(router.state.location.pathname).toBe(paths.login);
  });

  it("senha curta é recusada antes de enviar", async () => {
    const user = userEvent.setup();
    server = "no-session";
    renderApp("/redefinir-senha?token=valido");

    await user.type(await screen.findByLabelText("Nova senha"), "curta");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText("Use uma senha com pelo menos 8 caracteres.")).toBeVisible();
    expect(requestsTo("/auth/password/reset")).toHaveLength(0);
  });

  it("link usado ou vencido: explica e aponta para pedir outro", async () => {
    const user = userEvent.setup();
    server = "no-session";
    renderApp("/redefinir-senha?token=vencido");

    await user.type(await screen.findByLabelText("Nova senha"), "outra frase bem comprida");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Peça um novo link");
    expect(screen.getByRole("link", { name: "Pedir um novo link" })).toHaveAttribute(
      "href",
      paths.forgotPassword,
    );
  });

  it("endereço sem o código do link orienta a abrir o e-mail de novo", async () => {
    server = "no-session";
    renderApp(paths.resetPassword);

    expect(await screen.findByRole("heading", { name: "Link incompleto" })).toBeVisible();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
  });
});

describe("política de privacidade", () => {
  it("é pública e explica dados, IA, uso pelo provedor e cópias de 14 dias", async () => {
    server = "no-session";
    renderApp(paths.privacy);

    expect(
      await screen.findByRole("heading", { name: "Política de privacidade", level: 1 }),
    ).toBeVisible();
    for (const title of [
      "Quais dados o Contaí guarda",
      "Como seus dados são tratados",
      "O que é enviado ao serviço de inteligência artificial",
      "Como o serviço de IA pode usar esses dados",
      "Cópias de segurança",
    ]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByText(/melhorar os próprios modelos/)).toBeInTheDocument();
    expect(screen.getByText(/guardada por 14 dias/)).toBeInTheDocument();
    expect(screen.getByText(/Versão 1, de 1 de outubro de 2026/)).toBeInTheDocument();
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
