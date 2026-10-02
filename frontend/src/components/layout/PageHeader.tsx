import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  /** No máximo uma ação, à direita. */
  action?: ReactNode;
}

/** Cabeçalho da página: rola com o conteúdo, sem barra superior fixa. */
export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className="mb-5 flex min-h-11 items-center justify-between gap-3">
      <h1 className="font-display text-title-1 text-ink">{title}</h1>
      {action}
    </header>
  );
}
