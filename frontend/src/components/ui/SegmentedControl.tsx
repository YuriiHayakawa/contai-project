import { useId } from "react";

import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Nome do grupo, lido antes das opções. */
  label: string;
  /** Mantém o rótulo só para leitores de tela, quando o contexto já deixa claro o que é. */
  hideLabel?: boolean;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Escolha única entre poucas opções, como Despesa / Receita / Transferência. São botões de
 * rádio nativos: as setas do teclado trocam a opção e o grupo é anunciado com o rótulo.
 */
export function SegmentedControl<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  name,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const generatedName = useId();

  return (
    <fieldset disabled={disabled} className={cn("min-w-0", className)}>
      <legend className={cn("text-label text-ink", hideLabel ? "sr-only" : "mb-1.5")}>
        {label}
      </legend>
      <div className="grid auto-cols-fr grid-flow-col rounded-md bg-bg-sunken p-1">
        {options.map((option) => (
          <label key={option.value} className="relative flex min-w-0">
            <input
              type="radio"
              className="peer sr-only"
              name={name ?? generatedName}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span
              className={cn(
                "flex min-h-10 w-full items-center justify-center rounded-sm px-2 text-center",
                "text-label text-ink-muted transition-colors duration-fast ease-out",
                "peer-checked:bg-surface-raised peer-checked:text-ink peer-checked:shadow-sm",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
                "peer-focus-visible:outline-primary",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
