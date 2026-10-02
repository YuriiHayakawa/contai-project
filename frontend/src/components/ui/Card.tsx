import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface CardProps {
  /** Título em `title-3`. */
  title?: string;
  /** No máximo uma ação no cabeçalho, em botão `ghost`. Não se aplica ao cartão clicável. */
  action?: ReactNode;
  /** `highlight`: fundo `--primary-soft`, sem contorno; no máximo um por tela. */
  variant?: "default" | "highlight";
  /** Sem espaço interno, para listas com pauta que vão de borda a borda. */
  flush?: boolean;
  /** Torna o cartão inteiro um botão; sem ele, o cartão é só um agrupamento. */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

const padding = "p-4 sm:p-5";

/** Cartão plano: contorno, sem sombra. Não se aninha; dentro dele, a separação é por pauta. */
export function Card({
  title,
  action,
  variant = "default",
  flush = false,
  onClick,
  className,
  children,
}: CardProps) {
  const surface = cn(
    "block w-full rounded-lg text-left",
    variant === "highlight" ? "bg-primary-soft" : "border border-border bg-surface",
    flush ? "overflow-hidden" : padding,
    className,
  );

  // Dentro de um botão só cabe conteúdo de frase: o título vira texto e a ação não existe,
  // porque a área inteira do cartão já é o alvo.
  const content = (
    <>
      {onClick
        ? title && <span className="mb-3 block text-title-3 text-ink">{title}</span>
        : (title || action) && (
            <div
              className={cn(
                "mb-3 flex items-center justify-between gap-3",
                flush && "px-4 pt-4 sm:px-5 sm:pt-5",
              )}
            >
              {title && <h2 className="text-title-3 text-ink">{title}</h2>}
              {action}
            </div>
          )}
      {children}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(surface, "transition-colors duration-fast ease-out hover:bg-bg-sunken")}
      >
        {content}
      </button>
    );
  }
  return <section className={surface}>{content}</section>;
}
