import { CircleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "../../lib/cn";

/** O que todo campo com rótulo recebe (seção 6.2 do design-system.md). */
export interface FieldLabelProps {
  /** Sempre visível acima do campo; o placeholder nunca o substitui. */
  label: string;
  /** Marca o campo com "(opcional)" no rótulo; não se usa asterisco. */
  optional?: boolean;
  /** Ajuda abaixo do campo. */
  help?: string;
  /** Mensagem de erro, que diz como corrigir. */
  error?: string;
}

export interface FieldIds {
  id: string;
  helpId: string;
  errorId: string;
  /** Valor de `aria-describedby`: o erro e a ajuda que existirem. */
  describedBy: string | undefined;
}

interface FieldProps extends FieldLabelProps {
  ids: FieldIds;
  className?: string;
  children: ReactNode;
}

/** Ids do campo, da ajuda e do erro, ligados por `for`/`id` e `aria-describedby`. */
export function useFieldIds(
  idFromProps: string | undefined,
  { help, error }: Pick<FieldLabelProps, "help" | "error">,
): FieldIds {
  const generated = useId();
  const id = idFromProps ?? generated;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = cn(error && errorId, help && helpId) || undefined;
  return { id, helpId, errorId, describedBy };
}

/** Classes do controle: 48px de altura, texto de 16px, contorno de 1,5px. */
export function controlClass(hasError: boolean): string {
  return cn(
    "h-12 w-full rounded-md bg-surface px-3.5 text-body text-ink",
    "transition-colors duration-fast ease-out",
    "disabled:cursor-not-allowed disabled:bg-bg-sunken disabled:text-ink-subtle",
    hasError
      ? "border-2 border-danger"
      : "border-[1.5px] border-border-strong focus:border-primary",
  );
}

/** Rótulo, ajuda e erro em volta de um controle. */
export function Field({ ids, label, optional, help, error, className, children }: FieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={ids.id} className="text-label text-ink">
        {label}
        {optional && <span className="font-normal text-ink-muted"> (opcional)</span>}
      </label>
      {children}
      {error && (
        <p id={ids.errorId} className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {help && (
        <p id={ids.helpId} className="text-small text-ink-muted">
          {help}
        </p>
      )}
    </div>
  );
}
