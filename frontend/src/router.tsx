import { Hammer, LoaderCircle } from "lucide-react";
import { Suspense, lazy } from "react";
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router";

import { AppShell, PageContent } from "./components/layout/AppShell";
import { RouteErrorPage } from "./components/layout/ErrorPage";
import { PageHeader } from "./components/layout/PageHeader";
import { PageSkeleton } from "./components/layout/PageSkeleton";
import { EmptyState } from "./components/ui/EmptyState";
import { useAuth } from "./features/auth/hooks/useAuth";
import { useLogout } from "./features/auth/hooks/useLogout";
import {
  NewTransactionProvider,
  useNewTransaction,
} from "./features/transactions/hooks/useNewTransaction";
import { paths, returnPathFrom, type LoginLocationState } from "./lib/paths";

// Cada tela fica em um arquivo próprio do build e só é baixada quando o usuário chega a ela.
const LoginPage = lazy(() =>
  import("./features/auth/components/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./features/auth/components/RegisterPage").then((module) => ({
    default: module.RegisterPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import("./features/auth/components/ForgotPasswordPage").then((module) => ({
    default: module.ForgotPasswordPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import("./features/auth/components/VerifyEmailPage").then((module) => ({
    default: module.VerifyEmailPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("./features/auth/components/ResetPasswordPage").then((module) => ({
    default: module.ResetPasswordPage,
  })),
);
const PrivacyPolicyPage = lazy(() =>
  import("./features/auth/components/PrivacyPolicyPage").then((module) => ({
    default: module.PrivacyPolicyPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./features/dashboard/components/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const TransactionsPage = lazy(() =>
  import("./features/transactions/components/TransactionsPage").then((module) => ({
    default: module.TransactionsPage,
  })),
);
const AccountsPage = lazy(() =>
  import("./features/accounts/components/AccountsPage").then((module) => ({
    default: module.AccountsPage,
  })),
);
const CategoriesPage = lazy(() =>
  import("./features/categories/components/CategoriesPage").then((module) => ({
    default: module.CategoriesPage,
  })),
);
const ImportHistoryPage = lazy(() =>
  import("./features/imports/components/ImportHistoryPage").then((module) => ({
    default: module.ImportHistoryPage,
  })),
);
const UploadPage = lazy(() =>
  import("./features/imports/components/UploadPage").then((module) => ({
    default: module.UploadPage,
  })),
);
const ReviewPage = lazy(() =>
  import("./features/imports/components/ReviewPage").then((module) => ({
    default: module.ReviewPage,
  })),
);
const ChatPage = lazy(() =>
  import("./features/assistant/components/ChatPage").then((module) => ({
    default: module.ChatPage,
  })),
);

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

/**
 * Telas de entrada, cadastro e recuperação de senha: quem já está conectado não precisa delas
 * e segue para a rota de origem (ou para o início). Não é um guard de acesso: essas telas são
 * públicas.
 */
function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <LoadingScreen />;
  if (status === "authenticated") {
    return <Navigate to={returnPathFrom(location.state)} replace />;
  }
  return <Outlet />;
}

/** Casca do app, com a ação de "Lançar" e de "Novo lançamento" ligada à folha do formulário. */
function AppFrame() {
  const { user } = useAuth();
  const logout = useLogout();
  const openNewTransaction = useNewTransaction();

  return (
    <AppShell
      userName={user?.name ?? ""}
      onNewTransaction={() => openNewTransaction()}
      onSignOut={() => logout.mutate()}
    >
      {/* A casca fica na tela; só o miolo espera o código da tela chegar. */}
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

/** Telas fora da casca (entrada, cadastro, links dos e-mails): esperam com a tela de carga. */
function PublicFrame() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Outlet />
    </Suspense>
  );
}

function AppLayout() {
  return (
    <NewTransactionProvider>
      <AppFrame />
    </NewTransactionProvider>
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
    // Limite de erro das rotas: qualquer erro ao desenhar uma rota cai na ErrorPage.
    errorElement: <RouteErrorPage />,
    element: <PublicFrame />,
    children: [
      // Rotas públicas
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: paths.login, element: <LoginPage /> },
          { path: paths.register, element: <RegisterPage /> },
          { path: paths.forgotPassword, element: <ForgotPasswordPage /> },
        ],
      },
      // Os links dos e-mails funcionam com ou sem sessão aberta neste aparelho.
      { path: paths.verifyEmail, element: <VerifyEmailPage /> },
      { path: paths.resetPassword, element: <ResetPasswordPage /> },
      { path: paths.privacy, element: <PrivacyPolicyPage /> },
      ...devRoutes,

      // Rotas autenticadas: tudo o que exige sessão fica debaixo deste guard.
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: paths.home, element: <DashboardPage /> },
              { path: paths.transactions, element: <TransactionsPage /> },
              { path: paths.accounts, element: <AccountsPage /> },
              { path: paths.categories, element: <CategoriesPage /> },
              { path: paths.imports, element: <ImportHistoryPage /> },
              { path: paths.importNew, element: <UploadPage /> },
              { path: paths.importDetail, element: <UploadPage /> },
              { path: paths.importReview, element: <ReviewPage /> },
              { path: paths.assistantChat, element: <ChatPage /> },
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
