import { cn } from "../../../lib/cn";

export interface SuggestionsProps {
  /** Nome da lista para leitores de tela, como "Sugestões de perguntas". */
  label: string;
  items: readonly string[];
  /** A sugestão escolhida vai direto para o assistente, como uma pergunta digitada. */
  onPick: (text: string) => void;
  /** Aguardando uma resposta ou com o limite do dia atingido. */
  disabled?: boolean;
}

/**
 * Sugestões de pergunta e respostas rápidas (seção 8 do design-system.md): contorno, 44px de
 * altura mínima, e quebra em várias linhas em vez de rolar para o lado.
 */
export function Suggestions({ label, items, onPick, disabled = false }: SuggestionsProps) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="max-w-full">
          <button
            type="button"
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onPick(item);
            }}
            className={cn(
              "min-h-11 rounded-sm border-[1.5px] px-3.5 py-2 text-left text-label",
              "transition-colors duration-fast ease-out",
              disabled
                ? "cursor-not-allowed border-border bg-bg-sunken text-ink-subtle"
                : "border-border-strong bg-surface text-ink hover:bg-bg-sunken",
            )}
          >
            {item}
          </button>
        </li>
      ))}
    </ul>
  );
}
