import type { ReactNode } from "react";
import { Link } from "react-router";

import { TextLink } from "../../../components/ui/TextLink";
import { paths } from "../../../lib/paths";

export interface AuthLayoutProps {
  title: string;
  children: ReactNode;
  /** Caminho alternativo, como "Já tem conta? Entrar". */
  footer?: ReactNode;
}

/** Moldura das telas públicas de acesso: a marca, o título e uma coluna estreita. */
export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-100 flex-col justify-center gap-5 px-4 py-8">
      <Link
        to={paths.login}
        className="self-start rounded-sm font-display text-display font-extrabold text-primary"
      >
        Contaí
      </Link>
      <h1 className="font-display text-title-1 text-ink">{title}</h1>
      {children}
      <footer className="grid gap-1 text-body text-ink-muted">
        {footer && <p>{footer}</p>}
        <p>
          <TextLink to={paths.privacy} standalone>
            Política de privacidade
          </TextLink>
        </p>
      </footer>
    </main>
  );
}
