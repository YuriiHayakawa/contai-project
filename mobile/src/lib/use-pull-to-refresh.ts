// "Puxar para atualizar" só com o gesto do usuário. As recargas em segundo plano (voltar ao app,
// voltar à tela, um lançamento novo) não ligam o indicador: no iOS, ligar o `RefreshControl` por
// código mexe na rolagem, e a tela pularia para cima sozinha.
import { useCallback, useState } from "react";

export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}
