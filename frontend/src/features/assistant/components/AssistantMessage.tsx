import { cn } from "../../../lib/cn";
import type { ChatMessage } from "../types";
import { ProposalCard } from "./ProposalCard";
import { SourceTransactions } from "./SourceTransactions";

export interface AssistantMessageProps {
  message: ChatMessage;
  /** A resposta acabou de chegar: o traço de marca-texto é pintado. No histórico, já vem pronto. */
  fresh?: boolean;
}

export interface AnswerPart {
  text: string;
  /** `highlight` é o valor principal; `money`, os demais valores em reais. */
  kind: "plain" | "money" | "highlight";
}

// `R$ 1.234,56`, `R$ 45` e `−R$ 45,90`; o `\s` aceita também o espaço não separável.
const MONEY = /[−-]?R\$\s?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/g;
const MINUS_SIGNS = "−-";

/**
 * Separa o texto da resposta em trechos: o valor principal (a primeira ocorrência de
 * `highlight`, com o sinal de menos que vier colado antes dele), os demais valores em reais e
 * o resto.
 */
export function answerParts(content: string, highlight: string | null): AnswerPart[] {
  const ranges: { start: number; end: number; kind: AnswerPart["kind"] }[] = [];

  const at = highlight ? content.indexOf(highlight) : -1;
  if (highlight && at !== -1) {
    const signed = at > 0 && MINUS_SIGNS.includes(content.charAt(at - 1));
    ranges.push({ start: signed ? at - 1 : at, end: at + highlight.length, kind: "highlight" });
  }
  const main = ranges[0];
  for (const match of content.matchAll(MONEY)) {
    const start = match.index;
    const end = start + match[0].length;
    if (main && start < main.end && end > main.start) continue;
    ranges.push({ start, end, kind: "money" });
  }
  ranges.sort((a, b) => a.start - b.start);

  const parts: AnswerPart[] = [];
  let cursor = 0;
  for (const { start, end, kind } of ranges) {
    if (start > cursor) parts.push({ text: content.slice(cursor, start), kind: "plain" });
    parts.push({ text: content.slice(start, end), kind });
    cursor = end;
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), kind: "plain" });
  return parts;
}

function AssistantLabel() {
  return <p className="text-label text-ink-muted">Contaí</p>;
}

/**
 * Resposta do assistente (seção 8 do design-system.md): sem balão, escrita direto sobre o
 * fundo. O valor principal recebe o marca-texto, um só por mensagem; os demais valores usam a
 * classe `money`. Abaixo vêm as transações que compõem o número ou, no lançamento por texto, a
 * proposta para conferir.
 */
export function AssistantMessage({ message, fresh = false }: AssistantMessageProps) {
  return (
    <div className="grid justify-items-start gap-2">
      <AssistantLabel />
      <p className="text-body wrap-break-word whitespace-pre-line text-ink">
        {answerParts(message.content, message.highlight).map((part, index) => {
          if (part.kind === "highlight") {
            return (
              <strong
                key={index}
                className={cn("marca-texto money font-bold", fresh && "before:animate-paint")}
              >
                {part.text}
              </strong>
            );
          }
          if (part.kind === "money") {
            return (
              <span key={index} className="money">
                {part.text}
              </span>
            );
          }
          return part.text;
        })}
      </p>
      {message.transactions.length > 0 && (
        <SourceTransactions
          transactions={message.transactions}
          totalCount={message.transactions_total_count}
        />
      )}
      {message.proposal && <ProposalCard messageId={message.id} proposal={message.proposal} />}
    </div>
  );
}

/** Enquanto a resposta não chega: o texto e três pontos pulsando. */
export function AssistantWaiting() {
  return (
    <div className="grid justify-items-start gap-2">
      <AssistantLabel />
      <p className="flex items-center gap-2 text-body text-ink-muted">
        <span>
          Consultando seus lançamentos<span className="sr-only">…</span>
        </span>
        {/* Com movimento reduzido os pontos ficam parados; o texto continua (seção 9.4). */}
        <span aria-hidden="true" className="flex gap-1">
          <span className="size-1.5 animate-pulse rounded-full bg-ink-muted" />
          <span className="size-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:200ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:400ms]" />
        </span>
      </p>
    </div>
  );
}
