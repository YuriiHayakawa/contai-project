import { CircleAlert } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type" | "children"> {
  /** Texto ao lado da caixa; pode conter um link. */
  children: ReactNode;
  /** Mensagem de erro, que diz como corrigir. */
  error?: string;
}

/** Caixa de seleção de 24px com o texto ao lado; a linha inteira tem pelo menos 44px. */
export function Checkbox({ children, error, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <label
        htmlFor={inputId}
        className="flex min-h-11 items-start gap-3 py-2.5 text-body text-ink"
      >
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="size-6 shrink-0 accent-primary"
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
