import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { RouterProvider } from "react-router";

import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider } from "./features/auth/hooks/useAuth";
import { createQueryClient } from "./lib/query-client";
import { watchSystemTheme } from "./lib/theme";
import { createAppRouter } from "./router";

/**
 * Raiz do app: dados do servidor (TanStack Query), movimento reduzido conforme o sistema,
 * avisos, sessão e rotas. O limite de erro é o `errorElement` da rota raiz, em router.tsx: o
 * React só oferece limite de erro como componente de classe, que o projeto não usa.
 */
export default function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);

  // Em Automático, o tema acompanha o sistema enquanto o app está aberto.
  useEffect(() => watchSystemTheme(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
