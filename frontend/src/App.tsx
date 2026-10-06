import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { RouterProvider } from "react-router";

import { ErrorPage } from "./components/layout/ErrorPage";
import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider } from "./features/auth/hooks/useAuth";
import { createQueryClient } from "./lib/query-client";
import { watchSystemTheme } from "./lib/theme";
import { createAppRouter } from "./router";

/**
 * Raiz do app: dados do servidor (TanStack Query), movimento reduzido conforme o sistema,
 * avisos, sessão e rotas. Há dois limites de erro com a mesma tela: o `errorElement` da rota
 * raiz, para erros de uma rota, e o `ErrorBoundary` daqui, para erros dos próprios provedores.
 */
export default function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);

  // Em Automático, o tema acompanha o sistema enquanto o app está aberto.
  useEffect(() => watchSystemTheme(), []);

  return (
    <ErrorBoundary fallbackRender={({ error }) => <ErrorPage error={error} />}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </ToastProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
