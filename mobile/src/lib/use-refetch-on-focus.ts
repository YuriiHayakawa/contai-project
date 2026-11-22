// Atualiza uma tela quando ela volta a ficar visível: ao voltar de outra tela da pilha ou de
// outra aba. A volta ao app (AppState) é tratada pelo `bindAppFocus` do query-client.
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

export function useRefetchOnFocus(refetch: () => unknown): void {
  const firstFocus = useRef(true);
  // A função mais recente fica numa ref: o efeito depende só do foco. Se dependesse da função,
  // uma função nova a cada renderização recarregaria a tela sem parar.
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });

  useFocusEffect(
    useCallback(() => {
      // Na primeira vez, a consulta acabou de ser feita ao montar a tela.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void latest.current();
    }, []),
  );
}
