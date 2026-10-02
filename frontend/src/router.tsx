import { Hammer, LoaderCircle } from "lucide-react";
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router";

import { AppShell, PageContent } from "./components/layout/AppShell";
import { ErrorPage } from "./components/layout/ErrorPage";
import { PageHeader } from "./components/layout/PageHeader";
import { EmptyState } from "./components/ui/EmptyState";
import { useToast } from "./components/ui/Toast";
import { LoginPage } from "./features/auth/components/LoginPage";
import { useAuth } from "./features/auth/hooks/useAuth";
import { paths, type LoginLocationState } from "./lib/paths";

interface PendingPageProps {
  title: string;
}

function LoadingScreen() {
  return (
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <p className="font-display text-display font-extrabold text-primary">Contaí</p>
      <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-ink-muted" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

/**
 * Guard único das rotas autenticadas (Princípio IV). Quem não tem sessão vai para a tela de
 * entrada, levando a rota de origem para voltar a ela depois do login.
 */
export function RequireAuth() {
  const { status, retry } = useAuth();
  const location = useLocation();

  if (status === "loading") return <LoadingScreen />;

  if (status === "unavailable") {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <EmptyState
          kind="error"
          title="Não foi possível abrir o Contaí"
          description="Confira sua conexão com a internet e tente de novo."
          onAction={retry}
        />
      </main>
    );
  }

  if (status === "anonymous") {
    const state: LoginLocationState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to={paths.login} replace state={state} />;
  }

  return <Outlet />;
}

function AppLayout() {
  const { user } = useAuth();
  const toast = useToast();

  return (
    <AppShell
      userName={user?.name ?? ""}
      // A folha do formulário de lançamento entra na T093.
      onNewTransaction={() => toast.info("O formulário de lançamento ainda está sendo preparado.")}
    >
      <Outlet />
    </AppShell>
  );
}

/** Ocupa o lugar de uma tela até a história dela ser implementada. */
function PendingPage({ title }: PendingPageProps) {
  return (
    <PageContent>
      <PageHeader title={title} />
      <EmptyState
        kind="first-time"
        icon={Hammer}
        title="Em preparação"
        description="Esta parte do Contaí ainda está sendo feita."
      />
    </PageContent>
  );
}

function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        kind="no-results"
        title="Página não encontrada"
        description="O endereço pode ter mudado ou estar digitado errado."
        actionLabel="Ir para o início"
        onAction={() => void navigate(paths.home)}
      />
    </main>
  );
}

// Só no servidor de desenvolvimento: mostra a casca e os componentes base nos dois temas, sem
// depender de login. O `import.meta.env.DEV` tira a rota e o arquivo do build de produção.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/dev/componentes",
        lazy: async () => {
          const { ShowcasePage } = await import("./dev/ShowcasePage");
          return { Component: ShowcasePage };
        },
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    // O limite de erro do app: qualquer erro ao desenhar uma rota cai na ErrorPage.
    errorElement: <ErrorPage />,
    children: [
      // Rotas públicas
      { path: paths.login, element: <LoginPage /> },
      ...devRoutes,

      // Rotas autenticadas: tudo o que exige sessão fica debaixo deste guard.
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: paths.home, element: <PendingPage title="Início" /> },
              { path: paths.transactions, element: <PendingPage title="Lançamentos" /> },
              { path: paths.accounts, element: <PendingPage title="Contas" /> },
              { path: paths.categories, element: <PendingPage title="Categorias" /> },
              { path: paths.imports, element: <PendingPage title="Importações" /> },
              { path: paths.assistant, element: <PendingPage title="Assistente" /> },
              { path: paths.settings, element: <PendingPage title="Configurações" /> },
            ],
          },
        ],
      },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
