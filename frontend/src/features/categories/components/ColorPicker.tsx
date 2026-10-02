import { Check, CircleAlert } from "lucide-react";
import { useId } from "react";

import {
  CATEGORY_COLOR_LABELS,
  CATEGORY_FILL_CLASS,
  SELECTABLE_CATEGORY_COLORS,
  type SelectableCategoryColor,
} from "../../../components/ui/category-colors";
import { cn } from "../../../lib/cn";

export interface ColorPickerProps {
  /** Nome do grupo, lido antes das opções. */
  label: string;
  /** Nome do token escolhido; um valor fora da paleta deixa o grupo sem escolha. */
  value: string;
  onChange: (color: SelectableCategoryColor) => void;
  name?: string;
  /** Mensagem de erro, que diz como corrigir. */
  error?: string;
}

/**
 * Escolha da cor de uma categoria (seção 2.3 do design-system.md): só as oito amostras da
 * paleta, cada uma com o nome escrito ao lado. Não há cor livre nem valor em hexadecimal.
 */
export function ColorPicker({ label, value, onChange, name, error }: ColorPickerProps) {
  const generatedName = useId();
  const errorId = useId();

  return (
    <fieldset
      className="min-w-0"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-1.5 text-label text-ink">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SELECTABLE_CATEGORY_COLORS.map((color) => (
          <label key={color} className="relative flex min-w-0">
            <input
              type="radio"
              className="peer sr-only"
              name={name ?? generatedName}
              value={color}
              checked={color === value}
              onChange={() => onChange(color)}
            />
            <span
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2.5",
                "border-[1.5px] border-border-strong bg-surface text-label text-ink",
                "transition-colors duration-fast ease-out hover:bg-bg-sunken",
                "peer-checked:border-primary peer-checked:bg-primary-soft",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
                "peer-focus-visible:outline-primary",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-surface",
                  CATEGORY_FILL_CLASS[color],
                )}
              >
                {/* A marca reforça a escolha: a borda sozinha seria só cor. */}
                {color === value && <Check className="size-4" strokeWidth={3} />}
              </span>
              <span className="truncate">{CATEGORY_COLOR_LABELS[color]}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  );
}
