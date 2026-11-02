import { LoadingScreen } from "../../../components/layout/LoadingScreen";

/** O servidor dorme depois de um tempo sem acessos e leva cerca de um minuto para acordar. */
export const WAKING_SERVER_NOTICE = "Acordando o servidor. Pode levar até um minuto.";

/**
 * Espera do refresh silencioso, a primeira chamada à API ao abrir o app. Se ela demorar, a
 * causa provável é o servidor acordando (ADR 0010), e a tela diz isso.
 */
export function RestoringSessionScreen() {
  return <LoadingScreen slowNotice={WAKING_SERVER_NOTICE} />;
}
