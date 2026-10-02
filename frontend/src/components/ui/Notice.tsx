import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * - `error`: algo falhou; diz o que fazer. Anunciado na hora (`role="alert"`).
 * - `warning`: pede atenção antes de seguir, como uma sessão que expirou.
 * - `success` e `info`: confirmam ou orientam.
 */
export type NoticeKind = "error" | "warning" | "success" | "info";

export interface NoticeProps {
  kind: NoticeKind;
  children: ReactNode;
  /** No máximo uma ação, em botão `ghost`, abaixo do texto. */
  action?: ReactNode;
  className?: string;
}

const appearance: Record<NoticeKind, { icon: LucideIcon; surface: string; color: string }> = {
  error: { icon: CircleAlert, surface: "bg-danger-soft", color: "text-danger" },
  warning: { icon: TriangleAlert, surface: "bg-warning-soft", color: "text-warning" },
  success: { icon: CircleCheck, surface: "bg-income-soft", color: "text-income" },
  info: { icon: Info, surface: "bg-primary-soft", color: "text-primary" },
};

/** Mensagem em bloco dentro da página: ícone e texto, nunca só a cor. */
export function Notice({ kind, children, action, className }: NoticeProps) {
  const { icon: Icon, surface, color } = appearance[kind];

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg p-4 text-body text-ink", surface, className)}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", color)} />
      <div className="grid min-w-0 flex-1 justify-items-start gap-2">
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}
