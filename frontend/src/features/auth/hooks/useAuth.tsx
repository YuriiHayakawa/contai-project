import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { onSessionExpired } from "../../../lib/api-client";
import { endSession, restoreSession, startSession } from "../services/authService";
import type { CurrentUser } from "../types";

/**
 * - `loading`: o refresh silencioso ainda não respondeu.
 * - `unavailable`: o servidor não respondeu ao carregar; não dá para saber se há sessão.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";

export interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  /** A sessão acabou no meio do uso; a tela de entrada mostra o aviso. */
  sessionExpired: boolean;
  /** Entra com o access token recebido no login. */
  signIn: (accessToken: string) => Promise<void>;
  /** Esquece a sessão neste aparelho e apaga os dados em memória. */
  signOut: () => void;
  /** Tenta de novo o refresh silencioso, depois de `unavailable`. */
  retry: () => void;
}

export interface AuthProviderProps {
  children: ReactNode;
}

export const sessionQueryKey = ["auth", "session"] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Guarda o usuário atual. O access token fica só na memória do `api-client`; ao carregar, um
 * refresh silencioso recupera a sessão a partir do cookie.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);

  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: restoreSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Os dados em memória são de quem estava conectado: saem junto com a sessão.
  const forgetUserData = useCallback(() => {
    queryClient.setQueryData(sessionQueryKey, null);
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
    });
  }, [queryClient]);

  useEffect(
    () =>
      onSessionExpired(() => {
        setSessionExpired(true);
        forgetUserData();
      }),
    [forgetUserData],
  );

  const signIn = useCallback(
    async (accessToken: string) => {
      const user = await startSession(accessToken);
      queryClient.setQueryData(sessionQueryKey, user);
      setSessionExpired(false);
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    endSession();
    setSessionExpired(false);
    forgetUserData();
  }, [forgetUserData]);

  const { data, isPending, isError, refetch } = session;

  const value = useMemo<AuthContextValue>(() => {
    const user = data ?? null;
    let status: AuthStatus = "anonymous";
    if (user) status = "authenticated";
    else if (isPending) status = "loading";
    else if (isError) status = "unavailable";

    return {
      status,
      user,
      sessionExpired,
      signIn,
      signOut,
      retry: () => void refetch(),
    };
  }, [data, isPending, isError, refetch, sessionExpired, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  return value;
}
