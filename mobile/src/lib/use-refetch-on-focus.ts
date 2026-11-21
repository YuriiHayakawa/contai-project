// Atualiza uma tela quando ela volta a ficar visível: ao voltar de outra tela da pilha ou de
// outra aba. A volta ao app (AppState) é tratada pelo `bindAppFocus` do query-client.
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

export function useRefetchOnFocus(refetch: () => unknown): void {
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // Na primeira vez, a consulta acabou de ser feita ao montar a tela.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}
