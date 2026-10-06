import { cn } from "../../lib/cn";

export interface SkeletonProps {
  /** Tamanho do bloco, com classes de altura e largura (`h-4 w-32`). */
  className?: string;
}

export interface SkeletonListProps {
  /** O design system pede 5 linhas nas listas. */
  rows?: number;
  /** Texto lido por leitores de tela enquanto carrega. */
  label?: string;
}

/** Bloco que pulsa no lugar do conteúdo; com movimento reduzido, fica parado. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-sm bg-bg-sunken", className)}
    />
  );
}

/** Linhas de lista em carregamento, no formato da lista de transações. */
export function SkeletonList({ rows = 5, label = "Carregando…" }: SkeletonListProps) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <li
            key={index}
            className="flex min-h-16 items-center gap-3 border-b border-border px-3 last:border-b-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <span className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </span>
            <Skeleton className="h-4 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
