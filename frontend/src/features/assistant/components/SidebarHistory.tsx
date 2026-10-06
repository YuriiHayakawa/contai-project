import { Trash2 } from "lucide-react";
import { NavLink, useMatch, useNavigate } from "react-router";

import { Skeleton } from "../../../components/ui/Skeleton";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dayLabel, toISODate } from "../../../lib/dates";
import { conversationPath, paths } from "../../../lib/paths";
import { useConversations } from "../hooks/useConversations";
import { titleOf, useConversationDeletion } from "./useConversationDeletion";

const actionClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-small text-ink-muted " +
  "transition-colors duration-fast ease-out hover:bg-bg-sunken";

/**
 * Histórico de conversas dentro da barra lateral (FR-069): abre embaixo do item "Assistente",
 * com as conversas da mais recente para a mais antiga. Cada uma abre no chat e pode ser
 * apagada pela lixeira ao lado dela, com confirmação (FR-077). Apagar todas de uma vez fica só
 * na folha do histórico (`ConversationHistory`).
 */
export function SidebarHistory() {
  const navigate = useNavigate();
  const currentId = useMatch(paths.assistantChat)?.params.conversationId;
  const conversations = useConversations();
  const { ask, dialog } = useConversationDeletion({
    currentId,
    // Sem voltar pelo "voltar" do navegador a uma conversa que deixou de existir.
    onCurrentDeleted: () => void navigate(paths.assistant, { replace: true }),
  });

  const items = conversations.data?.pages.flatMap((page) => page.items);

  return (
    <>
      {conversations.isPending && (
        <div role="status" className="grid gap-3 px-3 py-2">
          <span className="sr-only">Carregando suas conversas…</span>
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      )}

      {conversations.isError && !items && (
        <div role="alert" className="grid justify-items-start gap-1 py-1">
          <p className="px-3 text-small text-ink-muted">{errorMessage(conversations.error)}</p>
          <button
            type="button"
            onClick={() => void conversations.refetch()}
            className={cn(actionClass, "font-bold text-primary")}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {items?.length === 0 && (
        <p className="px-3 py-2 text-small text-ink-muted">Nenhuma conversa ainda.</p>
      )}

      {items && items.length > 0 && (
        <>
          <ul aria-label="Histórico de conversas">
            {items.map((conversation) => {
              const title = titleOf(conversation);
              return (
                <li key={conversation.id} className="group relative">
                  <NavLink
                    to={conversationPath(conversation.id)}
                    title={`${title} · ${dayLabel(toISODate(new Date(conversation.updated_at)))}`}
                    className={({ isActive }) =>
                      cn(
                        // O título usa a largura toda; só abre espaço quando o botão de
                        // apagar aparece.
                        "block truncate rounded-md py-2 pr-3 pl-3 text-small",
                        "group-focus-within:pr-10 group-hover:pr-10 pointer-coarse:pr-10",
                        "transition-colors duration-fast ease-out",
                        isActive
                          ? "font-bold text-primary"
                          : "text-ink-muted hover:bg-bg-sunken hover:text-ink",
                      )
                    }
                  >
                    {title}
                  </NavLink>
                  {/* Aparece com o ponteiro em cima ou com o foco; em tela de toque, sempre. */}
                  <button
                    type="button"
                    aria-label={`Apagar a conversa: ${title}`}
                    onClick={() => ask({ kind: "one", conversation })}
                    className={cn(
                      "absolute top-0 right-0 flex size-9 items-center justify-center rounded-md",
                      "text-ink-subtle",
                      "opacity-0 transition-[opacity,background-color,color] duration-fast ease-out",
                      "group-focus-within:opacity-100 group-hover:opacity-100",
                      "hover:bg-bg-sunken hover:text-danger pointer-coarse:opacity-100",
                    )}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          {conversations.hasNextPage && (
            <button
              type="button"
              aria-busy={conversations.isFetchingNextPage || undefined}
              onClick={() => {
                if (!conversations.isFetchingNextPage) void conversations.fetchNextPage();
              }}
              className={cn(actionClass, "mt-1 font-bold text-primary")}
            >
              Carregar mais
            </button>
          )}
        </>
      )}

      {dialog}
    </>
  );
}
