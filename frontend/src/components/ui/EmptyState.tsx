import { CircleAlert, NotebookPen, SearchX, type LucideIcon } from "lucide-react";

import { Button } from "./Button";

/**
 * - `first-time`: convida e diz o que fazer ("Cadastre sua primeira conta").
 * - `no-results`: nada com os filtros atuais; oferece "Limpar filtros".
 * - `error`: a carga falhou; oferece "Tentar de novo".
 */
export type EmptyStateKind = "first-time" | "no-results" | "error";

export interface EmptyStateProps {
  kind: EmptyStateKind;
  title: string;
  /** Uma frase; no erro, diz o que fazer, e não só o que falhou. */
  description: string;
  /** Rótulo da ação; `no-results` e `error` já têm um padrão. */
  actionLabel?: string;
  onAction?: () => void;
  /** Ícone do assunto da tela, para `first-time`. */
  icon?: LucideIcon;
}

const defaults: Record<EmptyStateKind, { icon: LucideIcon; actionLabel?: string }> = {
  "first-time": { icon: NotebookPen },
  "no-results": { icon: SearchX, actionLabel: "Limpar filtros" },
  error: { icon: CircleAlert, actionLabel: "Tentar de novo" },
};

export function EmptyState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: EmptyStateProps) {
  const Icon = icon ?? defaults[kind].icon;
  const label = actionLabel ?? defaults[kind].actionLabel;

  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className="mx-auto flex max-w-80 flex-col items-center gap-3 px-4 py-8 text-center"
    >
      <span className="flex size-18 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" className="size-8" />
      </span>
      <h2 className="font-display text-title-2 text-ink">{title}</h2>
      <p className="text-body text-ink-muted">{description}</p>
      {onAction && label && (
        <Button className="mt-2" onClick={onAction}>
          {label}
        </Button>
      )}
    </div>
  );
}
