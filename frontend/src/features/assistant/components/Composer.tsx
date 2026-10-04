import { ArrowUp } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { IconButton } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { cn } from "../../../lib/cn";
import { dateTimeLabel } from "../../../lib/dates";
import { useMediaQuery } from "../../../lib/useMediaQuery";
import { MAX_QUESTION_LENGTH, type AssistantUsage } from "../types";

export interface ComposerProps {
  onSend: (content: string) => void;
  /** Aguardando a resposta: o campo e o botão ficam desativados. */
  busy: boolean;
  /** O uso do dia; enquanto não chega, o campo funciona sem o aviso de quantas restam. */
  usage: AssistantUsage | undefined;
}

/** A partir de quantas perguntas restantes o aviso aparece. */
export const LOW_REMAINING = 5;

// Com teclado físico, Enter envia. No celular o Enter do teclado virtual quebra a linha, e só
// o botão envia.
const PHYSICAL_KEYBOARD = "(hover: hover) and (pointer: fine)";

function remainingLabel(remaining: number): string {
  return remaining === 1 ? "Resta 1 pergunta hoje" : `Restam ${remaining} perguntas hoje`;
}

/**
 * Campo de escrita do chat (seção 8 do design-system.md): área de texto que cresce de 1 a 4
 * linhas e botão de enviar de 44px. Com 5 perguntas ou menos, avisa quantas restam; no limite
 * do dia, dá lugar ao aviso de quando o assistente volta (FR-071).
 */
export function Composer({ onSend, busy, usage }: ComposerProps) {
  const [text, setText] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const enterSends = useMediaQuery(PHYSICAL_KEYBOARD);
  const content = text.trim();

  // A altura acompanha o texto; o limite de 4 linhas e a rolagem ficam por conta do CSS.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [text]);

  if (usage?.remaining === 0) {
    return (
      <Notice kind="warning">
        Você atingiu o limite de perguntas de hoje. O assistente volta em{" "}
        {dateTimeLabel(usage.resets_at)}; o restante do Contaí continua funcionando.
      </Notice>
    );
  }

  const send = (): void => {
    if (busy || content === "") return;
    onSend(content);
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Durante a composição de um caractere (acentos, teclados asiáticos), Enter só a confirma.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!enterSends) return;
    event.preventDefault();
    send();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="grid gap-2"
    >
      {usage && usage.remaining <= LOW_REMAINING && (
        <p role="status" className="text-small text-ink-muted">
          {remainingLabel(usage.remaining)}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={fieldRef}
          rows={1}
          value={text}
          maxLength={MAX_QUESTION_LENGTH}
          aria-label="Sua pergunta"
          placeholder="Escreva sua pergunta"
          enterKeyHint={enterSends ? "send" : "enter"}
          // Só leitura, e não desativado: o foco continua no campo enquanto a resposta chega.
          readOnly={busy}
          aria-disabled={busy || undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            "max-h-30 min-h-12 w-full resize-none rounded-md border-[1.5px] px-3.5 py-2.5",
            "text-body transition-colors duration-fast ease-out focus:border-primary",
            busy
              ? "cursor-not-allowed border-border bg-bg-sunken text-ink-subtle"
              : "border-border-strong bg-surface text-ink",
          )}
        />
        <IconButton
          type="submit"
          variant="primary"
          aria-label="Enviar"
          disabled={busy || content === ""}
          className="mb-0.5"
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </div>
    </form>
  );
}
