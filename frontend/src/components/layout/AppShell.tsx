import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";

export interface AppShellProps {
  userName: string;
  /** Abre a folha de novo lançamento, pelo "Lançar" e pelo "Novo lançamento". */
  onNewTransaction: () => void;
  onSignOut?: () => void;
  /** O histórico de conversas do assistente, mostrado na barra lateral. */
  assistantHistory?: ReactNode;
  /** Mostra o item "Cartões" na navegação: só para quem tem cartão de crédito ativo. */
  hasCards?: boolean;
  children: ReactNode;
}

export interface PageContentProps {
  /** 1120px para o painel; o padrão, de 720px, serve a listas e formulários. */
  wide?: boolean;
  children: ReactNode;
}

const MAIN_ID = "conteudo";

/**
 * Casca do app (seção 6.9 do design-system.md): barra inferior até `lg`, barra lateral de
 * 248px a partir de `lg`, e o conteúdo com as margens da página.
 */
export function AppShell({
  userName,
  onNewTransaction,
  onSignOut,
  assistantHistory,
  hasCards = false,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-dvh pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-8 lg:pl-62">
      <a
        href={`#${MAIN_ID}`}
        className={cn(
          "sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50",
          "focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-3 focus:font-bold",
          "focus:text-primary focus:shadow-md",
        )}
      >
        Pular para o conteúdo
      </a>
      <Sidebar
        userName={userName}
        onNewTransaction={onNewTransaction}
        onSignOut={onSignOut}
        assistantHistory={assistantHistory}
        hasCards={hasCards}
      />
      <main id={MAIN_ID} tabIndex={-1} className="px-4 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-8">
        {children}
      </main>
      <BottomNav onNewTransaction={onNewTransaction} onSignOut={onSignOut} hasCards={hasCards} />
    </div>
  );
}

/** Limita a largura do conteúdo de uma página e o centraliza. */
export function PageContent({ wide = false, children }: PageContentProps) {
  return <div className={cn("mx-auto w-full", wide ? "max-w-280" : "max-w-180")}>{children}</div>;
}
