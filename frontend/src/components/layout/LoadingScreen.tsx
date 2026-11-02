import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

/** Quanto a espera dura antes de `slowNotice` aparecer. */
export const SLOW_LOADING_DELAY_MS = 5000;

export interface LoadingScreenProps {
  /** Explica a demora quando a espera passa de `SLOW_LOADING_DELAY_MS`. */
  slowNotice?: string;
}

/** Tela inteira de espera: a marca, o indicador de carregamento e, se demorar, o motivo. */
export function LoadingScreen({ slowNotice }: LoadingScreenProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!slowNotice) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [slowNotice]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <p className="font-display text-display font-extrabold text-primary">Contaí</p>
      <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-ink-muted" />
      {/* O espaço do aviso fica reservado: quando ele aparece, nada na tela se desloca. */}
      <div role="status" aria-live="polite" className="min-h-12 max-w-sm text-center">
        <span className="sr-only">Carregando…</span>
        {slow && <p className="text-body text-ink-muted">{slowNotice}</p>}
      </div>
    </div>
  );
}
