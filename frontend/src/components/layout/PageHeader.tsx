import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  /** No máximo uma ação, à direita. */
  action?: ReactNode;
}

/** Cabeçalho da página: rola com o conteúdo, sem barra superior fixa. */
export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    // Em 320px, um título longo com a ação ao lado não cabe: a ação desce para a linha de baixo.
    <header className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="font-display text-title-1 text-ink">{title}</h1>
      {action}
    </header>
  );
}
