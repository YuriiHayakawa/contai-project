import { Mic } from "lucide-react";

import { cn } from "../../../lib/cn";

/** Marca "por voz" nos lançamentos que a Siri fez (FR-028). Ícone e texto: nunca só a cor. */
export function VoiceBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 py-0.5",
        "text-micro font-semibold text-primary",
        className,
      )}
    >
      <Mic aria-hidden="true" className="size-3" />
      por voz
    </span>
  );
}

/** "Você disse: “gastei 45 no ifood”": a frase que a Siri entendeu. */
export function voicePhraseLabel(phrase: string): string {
  return `Você disse: “${phrase}”`;
}
