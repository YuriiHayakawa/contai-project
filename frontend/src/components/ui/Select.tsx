import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { Field, controlClass, useFieldIds, type FieldLabelProps } from "./Field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<"select">, "children">, FieldLabelProps {
  options: readonly SelectOption[];
  /** Primeira opção, sem valor, como "Escolha uma conta". */
  placeholder?: string;
}

/** Seleção nativa, com o mesmo desenho do campo de texto; no celular abre o seletor do sistema. */
export function Select({
  label,
  optional,
  help,
  error,
  id,
  options,
  placeholder,
  className,
  ...rest
}: SelectProps) {
  const ids = useFieldIds(id, { help, error });

  return (
    <Field
      ids={ids}
      label={label}
      optional={optional}
      help={help}
      error={error}
      className={className}
    >
      <div className="relative">
        <select
          {...rest}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(controlClass(Boolean(error)), "appearance-none truncate pr-11")}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 right-3.5 size-5 text-ink-muted"
        />
      </div>
    </Field>
  );
}
