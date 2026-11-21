// Estado da sessão do app: carregando (renovando na abertura), fora ou dentro, e o motivo da
// última saída, que a tela de entrada mostra. O guard das rotas (D2) lê daqui.
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type ApiError,
  bumpSessionGeneration,
  isApiError,
  refreshAccessToken,
  setSessionEndedListener,
} from "@/lib/api-client";
import { clearSession, readRefreshToken, saveRefreshToken, setAccessToken } from "@/lib/session";

export type SessionStatus = "loading" | "signedOut" | "signedIn";
/** Por que a sessão terminou: o usuário saiu, ou ela foi encerrada (expirou, outro aparelho). */
export type SignOutReason = "logout" | "expired";

export const SIGN_OUT_MESSAGES: Record<SignOutReason, string | null> = {
  logout: null,
  expired: "Sua sessão foi encerrada. Entre de novo para continuar.",
};

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface SessionContextValue {
  status: SessionStatus;
  /** Motivo da última saída; `null` antes de qualquer saída. */
  lastSignOutReason: SignOutReason | null;
  /** A renovação da abertura não alcançou o servidor; a sessão continua guardada. */
  restoreError: ApiError | null;
  retryRestore: () => void;
  signIn: (tokens: SessionTokens) => Promise<void>;
  signOut: (reason: SignOutReason) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [lastSignOutReason, setLastSignOutReason] = useState<SignOutReason | null>(null);
  const [restoreError, setRestoreError] = useState<ApiError | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  // Na abertura: com refresh token guardado, renova; sem ele, vai direto para a entrada.
  useEffect(() => {
    let active = true;
    async function restore(): Promise<void> {
      if (!(await readRefreshToken())) {
        if (active) setStatus("signedOut");
        return;
      }
      try {
        const renewed = await refreshAccessToken();
        if (!active) return;
        if (renewed) {
          setStatus("signedIn");
        } else {
          await clearSession();
          setLastSignOutReason("expired");
          setStatus("signedOut");
        }
      } catch (error) {
        if (active) setRestoreError(isApiError(error) ? error : null);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [restoreAttempt]);

  const endLocally = useCallback(
    (reason: SignOutReason) => {
      queryClient.clear();
      setLastSignOutReason(reason);
      setStatus("signedOut");
    },
    [queryClient],
  );

  // O cliente HTTP avisa quando a renovação falha no meio do uso.
  useEffect(() => {
    setSessionEndedListener(endLocally);
    return () => setSessionEndedListener(null);
  }, [endLocally]);

  const signIn = useCallback(async (tokens: SessionTokens) => {
    bumpSessionGeneration();
    setAccessToken(tokens.accessToken);
    await saveRefreshToken(tokens.refreshToken);
    setLastSignOutReason(null);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(
    async (reason: SignOutReason) => {
      bumpSessionGeneration();
      await clearSession();
      endLocally(reason);
    },
    [endLocally],
  );

  const retryRestore = useCallback(() => {
    setRestoreError(null);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  const value = useMemo(
    () => ({ status, lastSignOutReason, restoreError, retryRestore, signIn, signOut }),
    [status, lastSignOutReason, restoreError, retryRestore, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  return context;
}
