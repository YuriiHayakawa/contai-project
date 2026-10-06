import { CircleAlert } from "lucide-react";
import {
  useId,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type SyntheticEvent,
} from "react";

import { cn } from "../../lib/cn";
import { centsFromTypedText, formatCentsAsDecimal, parseBRLToCents } from "../../lib/money";

type NativeInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "inputMode" | "children"
>;

export interface MoneyInputProps extends NativeInputProps {
  /** Valor em centavos, sempre inteiro e positivo. O sinal vem do seletor de tipo. */
  value: number;
  onChange: (cents: number) => void;
  /** Com "Receita", o valor fica em `--income`; nos demais, em `--ink`. */
  tone?: "ink" | "income";
  /** Mensagem de erro, que diz como corrigir. */
  error?: string;
}

/**
 * Campo de dinheiro (seção 6.3 do design-system.md): prefixo `R$` fixo, valor grande sobre uma
 * linha de pauta e digitação de caixa registradora, com os algarismos entrando pela direita.
 */
export function MoneyInput({
  value,
  onChange,
  tone = "ink",
  error,
  id,
  className,
  "aria-label": ariaLabel = "Valor em reais",
  "aria-describedby": describedBy,
  ...rest
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(centsFromTypedText(event.target.value, value));
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    // Um valor colado é lido como valor (`1.234,56` ou `1234.56`), e não tecla por tecla.
    event.preventDefault();
    const cents = parseBRLToCents(event.clipboardData.getData("text"));
    if (cents !== null) onChange(cents);
  };

  // O cursor fica sempre no fim: é o que faz cada tecla entrar pela direita.
  const keepCaretAtEnd = (event: SyntheticEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) {
      input.setSelectionRange(end, end);
    }
  };

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div
        className={cn(
          "flex items-baseline gap-2 border-b-2 pb-1.5 transition-colors duration-fast ease-out",
          error ? "border-danger" : "border-border-strong focus-within:border-primary",
        )}
      >
        <span aria-hidden="true" className="money text-title-2 font-normal text-ink-muted">
          R$
        </span>
        <input
          {...rest}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          // A ajuda de quem usa o campo continua valendo quando aparece um erro.
          aria-describedby={cn(error && errorId, describedBy) || undefined}
          value={formatCentsAsDecimal(value)}
          onChange={handleChange}
          onPaste={handlePaste}
          onSelect={keepCaretAtEnd}
          className={cn(
            // A linha de pauta já mostra o foco; o anel em volta do número seria ruído.
            "money w-full min-w-0 bg-transparent text-money-hero outline-none",
            "lg:text-money-hero-lg disabled:cursor-not-allowed disabled:text-ink-subtle",
            tone === "income" ? "text-income" : "text-ink",
          )}
        />
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
