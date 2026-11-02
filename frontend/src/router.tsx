import { Suspense, lazy } from "react";
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router";

import { AppShell } from "./components/layout/AppShell";
import { RouteErrorPage } from "./components/layout/ErrorPage";
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { PageSkeleton } from "./components/layout/PageSkeleton";
import { EmptyState } from "./components/ui/EmptyState";
import { useAccounts } from "./features/accounts/hooks/useAccounts";
import { SidebarHistory } from "./features/assistant/components/SidebarHistory";
import { RestoringSessionScreen } from "./features/auth/components/RestoringSessionScreen";
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
const TwoFactorStep = lazy(() =>
  import("./features/auth/components/TwoFactorStep").then((module) => ({
    default: module.TwoFactorStep,
  })),
);
const TwoFactorResetRequestPage = lazy(() =>
  import("./features/auth/components/TwoFactorResetRequestPage").then((module) => ({
    default: module.TwoFactorResetRequestPage,
  })),
);
const TwoFactorResetConfirmPage = lazy(() =>
  import("./features/auth/components/TwoFactorResetConfirmPage").then((module) => ({
    default: module.TwoFactorResetConfirmPage,
  })),
);
const TwoFactorResetCancelPage = lazy(() =>
  import("./features/auth/components/TwoFactorResetCancelPage").then((module) => ({
    default: module.TwoFactorResetCancelPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/components/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const PendingDeletionPage = lazy(() =>
  import("./features/settings/components/PendingDeletionPage").then((module) => ({
    default: module.PendingDeletionPage,
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
const CardsPage = lazy(() =>
  import("./features/cards/components/CardsPage").then((module) => ({
    default: module.CardsPage,
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

/**
 * Guard único das rotas autenticadas (Princípio IV). Quem não tem sessão vai para a tela de
 * entrada, levando a rota de origem para voltar a ela depois do login.
 */
export function RequireAuth() {
  const { status, retry } = useAuth();
  const location = useLocation();

  if (status === "loading") return <RestoringSessionScreen />;

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
 * Guard das telas internas: uma conta com exclusão pedida não entra no app. Fica na tela única
 * de exclusão, onde só dá para cancelar ou sair, até a conta voltar a ser ativa (FR-017).
 */
function RequireActiveAccount() {
  const { user } = useAuth();
  if (user?.status === "pending_deletion") {
    return <Navigate to={paths.pendingDeletion} replace />;
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

  if (status === "loading") return <RestoringSessionScreen />;
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
  const accounts = useAccounts();
  // "Cartões" só entra na navegação de quem tem cartão: para os outros seria uma tela vazia.
  const hasCards = (accounts.data ?? []).some(
    (account) => account.type === "credit_card" && !account.archived,
  );

  return (
    <AppShell
      userName={user?.name ?? ""}
      onNewTransaction={() => openNewTransaction()}
      onSignOut={() => logout.mutate()}
      assistantHistory={<SidebarHistory />}
      hasCards={hasCards}
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
          // Etapas da entrada com verificação em duas etapas: dependem do desafio, em memória.
          { path: paths.twoFactorLogin, element: <TwoFactorStep /> },
          { path: paths.twoFactorResetRequest, element: <TwoFactorResetRequestPage /> },
        ],
      },
      // Os links dos e-mails funcionam com ou sem sessão aberta neste aparelho.
      { path: paths.verifyEmail, element: <VerifyEmailPage /> },
      { path: paths.resetPassword, element: <ResetPasswordPage /> },
      { path: paths.twoFactorResetConfirm, element: <TwoFactorResetConfirmPage /> },
      { path: paths.twoFactorResetCancel, element: <TwoFactorResetCancelPage /> },
      { path: paths.privacy, element: <PrivacyPolicyPage /> },
      ...devRoutes,

      // Rotas autenticadas: tudo o que exige sessão fica debaixo deste guard.
      {
        element: <RequireAuth />,
        children: [
          // A tela de conta em exclusão fica fora da casca: sem navegação para o resto do app.
          { path: paths.pendingDeletion, element: <PendingDeletionPage /> },
          {
            element: <RequireActiveAccount />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: paths.home, element: <DashboardPage /> },
                  { path: paths.transactions, element: <TransactionsPage /> },
                  { path: paths.accounts, element: <AccountsPage /> },
                  { path: paths.cards, element: <CardsPage /> },
                  { path: paths.categories, element: <CategoriesPage /> },
                  { path: paths.imports, element: <ImportHistoryPage /> },
                  { path: paths.importNew, element: <UploadPage /> },
                  { path: paths.importDetail, element: <UploadPage /> },
                  { path: paths.importReview, element: <ReviewPage /> },
                  { path: paths.assistantChat, element: <ChatPage /> },
                  { path: paths.settings, element: <SettingsPage /> },
                ],
              },
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
