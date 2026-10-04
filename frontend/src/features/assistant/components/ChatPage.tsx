import { History, SquarePen } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { Button, IconButton } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { Skeleton } from "../../../components/ui/Skeleton";
import { errorMessage, isApiError } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { enterTransition } from "../../../lib/motion";
import { conversationPath, paths } from "../../../lib/paths";
import { useAssistantUsage, useSuggestions } from "../hooks/useAssistantUsage";
import { useConversation } from "../hooks/useConversation";
import { isLimitReached, useSendMessage } from "../hooks/useSendMessage";
import type { ChatMessage } from "../types";
import { AssistantMessage, AssistantWaiting } from "./AssistantMessage";
import { Composer } from "./Composer";
import { ConversationHistory } from "./ConversationHistory";
import { Suggestions } from "./Suggestions";
import { UserMessage } from "./UserMessage";

const NO_MESSAGES: readonly ChatMessage[] = [];
const SUGGESTIONS_LABEL = "Sugestões de perguntas";
// As mesmas margens laterais da casca: o cabeçalho e a faixa do campo vão de borda a borda.
const GUTTER = "px-4 sm:px-6 lg:px-8";

/** A cota do dia do serviço de IA acabou para o app inteiro: só volta amanhã (FR-072). */
function isQuotaExhausted(error: unknown): boolean {
  return isApiError(error) && error.code === "ai_quota_exhausted";
}

/** Mensagem do chat que entra: 6px na vertical e opacidade (seção 9.2 do design-system.md). */
const ENTERING = { opacity: 0, y: 6 } as const;
const SETTLED = { opacity: 1, y: 0 } as const;

// Só precisa ser único enquanto a página está aberta.
let nextLocalId = 1;

/**
 * Chat do assistente (seção 8 do design-system.md): cabeçalho fixo com o acesso ao histórico,
 * a conversa e o campo de escrita fixo na base. Enquanto a resposta não chega, a conversa
 * mostra "Consultando seus lançamentos…"; se a pergunta falha, ela fica na tela com o aviso e
 * o "Tentar de novo", porque o servidor não grava pergunta sem resposta.
 */
export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const conversation = useConversation(conversationId);
  const usage = useAssistantUsage();
  const suggestions = useSuggestions();
  const ask = useSendMessage();
  const [historyOpen, setHistoryOpen] = useState(false);
  // As perguntas feitas nesta visita: elas e as respostas delas entram com movimento.
  const [askedHere, setAskedHere] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLOListElement>(null);

  const messages = conversationId ? conversation.data?.messages : NO_MESSAGES;
  const count = messages?.length ?? 0;

  // A pergunta em andamento ou que falhou. Ela só existe na tela até a resposta chegar e as
  // duas entrarem na conversa; numa conversa nova, isso acontece junto com a troca de endereço.
  const asked = ask.variables;
  const delivered =
    asked !== undefined && (messages ?? []).some((message) => message.id === asked.localId);
  const open =
    asked !== undefined && !ask.isIdle && asked.conversationId === conversationId && !delivered;
  const waiting = open && !ask.isError;
  // No limite do dia, quem avisa é o campo de escrita, que dá lugar ao horário da volta.
  const failed = open && ask.isError && !isLimitReached(ask.error);
  // A cota do serviço só volta amanhã: tentar de novo agora não adianta.
  const retryable = !isQuotaExhausted(ask.error);

  const { isSuccess, reset } = ask;
  const answeredId = ask.data?.conversationId;
  const startedHere = asked?.conversationId === undefined;
  useEffect(() => {
    if (!isSuccess || !answeredId) return;
    if (delivered) reset();
    // A primeira resposta de uma conversa nova: o endereço passa a ser o da conversa.
    else if (conversationId === undefined && startedHere) {
      void navigate(conversationPath(answeredId), { replace: true });
    }
  }, [isSuccess, answeredId, delivered, conversationId, startedHere, reset, navigate]);

  // A conversa acompanha o que chega: a pergunta, a espera, a resposta ou o aviso. O que
  // chegou por último sobe até o cabeçalho; se for curto, a página só vai até o fim, e uma
  // resposta longa aparece desde o começo, com o valor principal à vista.
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "start" });
  }, [count, open, failed]);

  const send = (content: string): void => {
    const localId = `local-${nextLocalId++}`;
    setAskedHere((current) => new Set(current).add(localId));
    ask.mutate({ conversationId, content, localId });
  };

  const startNew = (): void => {
    reset();
    void navigate(paths.assistant);
  };

  const isFresh = (index: number): boolean => {
    const own = messages?.[index]?.id;
    const previous = messages?.[index - 1]?.id;
    return (
      (own !== undefined && askedHere.has(own)) ||
      (previous !== undefined && askedHere.has(previous))
    );
  };

  const limitReached = usage.data?.remaining === 0;
  const lastMessage = messages?.at(-1);
  const loadFailed = conversationId !== undefined && conversation.isError && !messages;
  const notFound =
    loadFailed && isApiError(conversation.error) && conversation.error.status === 404;

  return (
    <>
      {/* A página ocupa a tela toda: as margens da casca entram no cabeçalho e na faixa do
          campo de escrita, que ficam fixos enquanto as mensagens rolam por baixo. */}
      <div
        className={cn(
          "-mx-4 -mt-5 -mb-[calc(5.75rem+env(safe-area-inset-bottom))] flex min-h-dvh flex-col",
          "sm:-mx-6 lg:-mx-8 lg:-mt-8 lg:-mb-8",
        )}
      >
        <header className={cn("sticky top-0 z-10 bg-bg pt-5 pb-3 lg:pt-8", GUTTER)}>
          <PageContent>
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-display text-title-1 text-ink">Assistente</h1>
              <div className="flex items-center gap-1">
                {conversationId && (
                  <IconButton aria-label="Nova conversa" title="Nova conversa" onClick={startNew}>
                    <SquarePen aria-hidden="true" />
                  </IconButton>
                )}
                <IconButton
                  aria-label="Histórico de conversas"
                  title="Histórico de conversas"
                  aria-haspopup="dialog"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </PageContent>
        </header>

        <div className={cn("flex-1 pt-2 pb-6", GUTTER)}>
          <PageContent>
            {conversationId && conversation.isPending && (
              <div role="status" className="grid gap-5">
                <span className="sr-only">Carregando a conversa…</span>
                <Skeleton className="ml-auto h-11 w-3/5 rounded-lg" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            )}

            {loadFailed &&
              (notFound ? (
                <EmptyState
                  kind="no-results"
                  title="Conversa não encontrada"
                  description="Ela pode ter sido apagada. As outras continuam no histórico."
                  actionLabel="Começar outra conversa"
                  onAction={startNew}
                />
              ) : (
                <EmptyState
                  kind="error"
                  title="Não foi possível carregar a conversa"
                  description={errorMessage(conversation.error)}
                  onAction={() => void conversation.refetch()}
                />
              ))}

            {messages && count === 0 && !open && (
              <section aria-labelledby="chat-vazio" className="grid gap-4">
                <h2 id="chat-vazio" className="font-display text-title-2 text-ink">
                  Pergunte sobre o seu dinheiro
                </h2>
                {suggestions.isPending && (
                  <div role="status" className="grid gap-2">
                    <span className="sr-only">Carregando sugestões…</span>
                    <Skeleton className="h-11 w-4/5" />
                    <Skeleton className="h-11 w-3/5" />
                    <Skeleton className="h-11 w-4/5" />
                  </div>
                )}
                {suggestions.data && (
                  <Suggestions
                    label={SUGGESTIONS_LABEL}
                    items={suggestions.data}
                    onPick={send}
                    disabled={ask.isPending || limitReached}
                  />
                )}
              </section>
            )}

            {messages && (count > 0 || open) && (
              // A resposta nova é anunciada inteira, quando chega, e não palavra por palavra.
              <ol
                ref={listRef}
                aria-label="Conversa"
                aria-live="polite"
                // A margem de rolagem é a altura do cabeçalho fixo.
                className="grid gap-5 *:scroll-mt-20 lg:*:scroll-mt-24"
              >
                {/* As mensagens só entram no fim: a posição é a identidade de cada uma, e a
                  pergunta em andamento já ocupa a posição que terá na conversa. */}
                {messages.map((message, index) => (
                  <motion.li
                    key={index}
                    className="grid gap-3"
                    initial={isFresh(index) ? ENTERING : false}
                    animate={SETTLED}
                    transition={enterTransition}
                  >
                    {message.role === "user" ? (
                      <UserMessage content={message.content} />
                    ) : (
                      <AssistantMessage message={message} fresh={isFresh(index)} />
                    )}
                    {/* A recusa vem com exemplos do que perguntar; só na última mensagem. */}
                    {message.kind === "refusal" && message === lastMessage && suggestions.data && (
                      <Suggestions
                        label={SUGGESTIONS_LABEL}
                        items={suggestions.data}
                        onPick={send}
                        disabled={ask.isPending || limitReached}
                      />
                    )}
                  </motion.li>
                ))}
                {open && (
                  <motion.li
                    key={count}
                    initial={ENTERING}
                    animate={SETTLED}
                    transition={enterTransition}
                  >
                    <UserMessage content={asked.content} />
                  </motion.li>
                )}
                {waiting && (
                  <motion.li
                    key="waiting"
                    initial={ENTERING}
                    animate={SETTLED}
                    transition={enterTransition}
                  >
                    <AssistantWaiting />
                  </motion.li>
                )}
                {failed && (
                  <motion.li
                    key="failed"
                    initial={ENTERING}
                    animate={SETTLED}
                    transition={enterTransition}
                  >
                    <Notice
                      kind={retryable ? "error" : "warning"}
                      action={
                        retryable && (
                          <Button
                            variant="ghost"
                            className="-ml-5"
                            onClick={() => ask.mutate(asked)}
                          >
                            Tentar de novo
                          </Button>
                        )
                      }
                    >
                      {errorMessage(ask.error)}
                    </Notice>
                  </motion.li>
                )}
              </ol>
            )}
          </PageContent>
        </div>

        {/* A faixa tem fundo próprio e passa por trás da barra inferior; no celular, sobram
            20px entre o campo e a barra, para o botão de lançar não cobrir o campo. */}
        {!loadFailed && (
          <div
            className={cn(
              "sticky bottom-0 z-10 bg-bg pt-3",
              "pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-5",
              GUTTER,
            )}
          >
            <PageContent>
              <Composer onSend={send} busy={ask.isPending} usage={usage.data} />
            </PageContent>
          </div>
        )}
      </div>

      <ConversationHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentId={conversationId}
        // Sem voltar pelo "voltar" do navegador a uma conversa que deixou de existir.
        onCurrentDeleted={() => void navigate(paths.assistant, { replace: true })}
      />
    </>
  );
}
