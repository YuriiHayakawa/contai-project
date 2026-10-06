import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/cn";

export type SealTone = "warning" | "danger" | "info" | "success" | "neutral";

export interface SealProps {
  tone: SealTone;
  icon: LucideIcon;
  children: ReactNode;
}

const TONES: Record<SealTone, string> = {
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-primary-soft text-primary",
  success: "bg-income-soft text-income",
  neutral: "bg-bg-sunken text-ink-muted",
};

/** Selo de uma linha, como "Possível duplicata": ícone e texto, nunca só a cor. */
export function Seal({ tone, icon: Icon, children }: SealProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-micro",
        TONES[tone],
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
