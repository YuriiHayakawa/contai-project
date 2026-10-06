import { LoaderCircle } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** `compact` (40px) só em telas a partir de `lg` ou dentro de linhas. */
export type ButtonSize = "default" | "compact";

interface ButtonBehaviorProps extends Omit<ComponentProps<"button">, "disabled"> {
  variant?: ButtonVariant;
  /** Cliques são ignorados; o botão continua alcançável pelo teclado, com `aria-disabled`. */
  disabled?: boolean;
  /** O rótulo fica, o indicador entra à esquerda e a largura não muda. */
  loading?: boolean;
}

export interface ButtonProps extends ButtonBehaviorProps {
  size?: ButtonSize;
  /** Ocupa a largura toda, como em formulários no celular. */
  block?: boolean;
  /** Ícone de 20px à esquerda do rótulo. */
  icon?: ReactNode;
  children: ReactNode;
}

export interface IconButtonProps extends ButtonBehaviorProps {
  /** Obrigatório: um botão só de ícone não tem outro nome acessível. */
  "aria-label": string;
  children: ReactNode;
}

interface SpinnerProps {
  className: string;
}

const base =
  "inline-flex shrink-0 items-center justify-center rounded-md text-body font-bold select-none " +
  "transition-[background-color,border-color,color,filter,scale] duration-fast ease-out";

const pressable = "active:scale-[0.98] active:duration-instant";
const inactive = "cursor-not-allowed bg-bg-sunken text-ink-subtle";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border-[1.5px] border-border-strong bg-surface text-ink hover:bg-bg-sunken",
  ghost: "text-primary hover:bg-bg-sunken",
  danger: "bg-danger text-on-danger hover:brightness-90",
};

// Sozinho, o ícone usa a tinta secundária; o azul fica para as ações com texto.
const iconVariants: Record<ButtonVariant, string> = {
  ...variants,
  ghost: "text-ink-muted hover:bg-bg-sunken",
};

function guardClick(
  blocked: boolean,
  onClick: ComponentProps<"button">["onClick"],
): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    if (blocked) {
      // Também impede o envio do formulário por um botão de submit desativado.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
}

function Spinner({ className }: SpinnerProps) {
  return <LoaderCircle aria-hidden="true" className={cn("animate-spin", className)} />;
}

export function Button({
  variant = "primary",
  size = "default",
  block = false,
  disabled = false,
  loading = false,
  icon,
  type = "button",
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  // O indicador ocupa o lugar do ícone; sem ícone, o espaço interno encolhe 12px de cada lado
  // para caber o indicador (16px) e o intervalo (8px) sem mudar a largura do botão.
  const spinnerInPadding = loading && !icon;

  return (
    <button
      {...rest}
      type={type}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      onClick={guardClick(disabled || loading, onClick)}
      className={cn(
        base,
        "gap-2",
        size === "default" ? "h-12" : "h-10",
        spinnerInPadding ? "px-2" : "px-5",
        block && "w-full",
        disabled ? inactive : variants[variant],
        !disabled && !loading && pressable,
        loading && "cursor-progress",
        className,
      )}
    >
      {loading ? (
        <Spinner className={icon ? "size-5" : "size-4"} />
      ) : (
        icon && (
          <span aria-hidden="true" className="inline-flex size-5 [&>svg]:size-full">
            {icon}
          </span>
        )
      )}
      {children}
    </button>
  );
}

/** Botão só de ícone, de 44 × 44px, para ações universais: fechar, voltar, mostrar senha. */
export function IconButton({
  variant = "ghost",
  disabled = false,
  loading = false,
  type = "button",
  className,
  onClick,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      onClick={guardClick(disabled || loading, onClick)}
      className={cn(
        base,
        "size-11 [&>svg]:size-5",
        disabled ? inactive : iconVariants[variant],
        !disabled && !loading && pressable,
        loading && "cursor-progress",
        className,
      )}
    >
      {loading ? <Spinner className="size-5" /> : children}
    </button>
  );
}
