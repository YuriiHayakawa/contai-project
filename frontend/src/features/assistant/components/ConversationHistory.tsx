import { Trash2 } from "lucide-react";
import { Link } from "react-router";

import { Button, IconButton } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Notice } from "../../../components/ui/Notice";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dayLabel, toISODate } from "../../../lib/dates";
import { conversationPath } from "../../../lib/paths";
import { useConversations } from "../hooks/useConversations";
import { titleOf, useConversationDeletion } from "./useConversationDeletion";

export interface ConversationHistoryProps {
  open: boolean;
  onClose: () => void;
  /** A conversa aberta no chat, marcada na lista. */
  currentId: string | undefined;
  /** A conversa aberta foi apagada, sozinha ou com todas: o chat volta a ficar vazio. */
  onCurrentDeleted: () => void;
}

/**
 * Histórico de conversas (FR-069) em uma folha, para as telas sem barra lateral: abrir uma
 * conversa, apagar uma e apagar todas. A partir de `lg`, o histórico fica na barra lateral
 * (`SidebarHistory`).
 */
export function ConversationHistory({
  open,
  onClose,
  currentId,
  onCurrentDeleted,
}: ConversationHistoryProps) {
  const conversations = useConversations(open);
  const { ask, dialog } = useConversationDeletion({
    currentId,
    onCurrentDeleted,
    onAllDeleted: onClose,
  });

  const items = conversations.data?.pages.flatMap((page) => page.items);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Histórico de conversas"
        footer={
          items &&
          items.length > 0 && (
            <Button variant="secondary" icon={<Trash2 />} onClick={() => ask({ kind: "all" })}>
              Apagar todas
            </Button>
          )
        }
      >
        {conversations.isPending && <SkeletonList rows={3} label="Carregando suas conversas…" />}

        {conversations.isError && !items && (
          <Notice
            kind="error"
            action={
              <Button
                variant="ghost"
                className="-ml-5"
                onClick={() => void conversations.refetch()}
              >
                Tentar de novo
              </Button>
            }
          >
            {errorMessage(conversations.error)}
          </Notice>
        )}

        {items?.length === 0 && (
          <p className="py-2 text-body text-ink-muted">
            Você ainda não tem conversas. As perguntas que você fizer ficam guardadas aqui.
          </p>
        )}

        {items && items.length > 0 && (
          <ul>
            {items.map((conversation) => {
              const current = conversation.id === currentId;
              return (
                <li
                  key={conversation.id}
                  className="flex items-center gap-1 border-b border-border last:border-b-0"
                >
                  <Link
                    to={conversationPath(conversation.id)}
                    aria-current={current ? "page" : undefined}
                    onClick={onClose}
                    className="grid min-h-14 min-w-0 flex-1 content-center rounded-sm py-2"
                  >
                    <span
                      className={cn(
                        "truncate text-body font-bold",
                        current ? "text-primary" : "text-ink",
                      )}
                    >
                      {titleOf(conversation)}
                    </span>
                    <span className="text-small text-ink-muted">
                      {dayLabel(toISODate(new Date(conversation.updated_at)))}
                    </span>
                  </Link>
                  <IconButton
                    aria-label={`Apagar a conversa: ${titleOf(conversation)}`}
                    onClick={() => ask({ kind: "one", conversation })}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}

        {conversations.hasNextPage && (
          <div className="flex justify-center pt-3">
            <Button
              variant="secondary"
              loading={conversations.isFetchingNextPage}
              onClick={() => void conversations.fetchNextPage()}
            >
              Carregar mais
            </Button>
          </div>
        )}
      </Modal>

      {dialog}
    </>
  );
}
