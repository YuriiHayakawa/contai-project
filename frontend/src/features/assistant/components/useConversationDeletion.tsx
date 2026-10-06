import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { useDeleteAllConversations, useDeleteConversation } from "../hooks/useConversations";
import type { Conversation } from "../types";

/** O que está para ser apagado: uma conversa ou o histórico inteiro. */
export type DeletionTarget = { kind: "one"; conversation: Conversation } | { kind: "all" };

export interface ConversationDeletionOptions {
  /** A conversa aberta no chat. */
  currentId: string | undefined;
  /** A conversa aberta foi apagada, sozinha ou com todas: o chat volta a ficar vazio. */
  onCurrentDeleted: () => void;
  /** Todo o histórico foi apagado. */
  onAllDeleted?: () => void;
}

export interface ConversationDeletion {
  /** Pede a confirmação antes de apagar. */
  ask: (target: DeletionTarget) => void;
  /** O diálogo de confirmação; quem usa o hook o desenha uma vez. */
  dialog: ReactNode;
}

// A conversa aberta para uma pergunta que não chegou a ser respondida.
const UNTITLED = "Conversa sem perguntas";

export const titleOf = (conversation: Conversation): string => conversation.title || UNTITLED;

/**
 * Apagar uma conversa ou todas (FR-069), do mesmo jeito em qualquer lugar em que o histórico
 * aparece: com confirmação, porque não tem volta (FR-077), e com o aviso do que aconteceu.
 */
export function useConversationDeletion({
  currentId,
  onCurrentDeleted,
  onAllDeleted,
}: ConversationDeletionOptions): ConversationDeletion {
  const toast = useToast();
  const deleteOne = useDeleteConversation();
  const deleteAll = useDeleteAllConversations();
  const [open, setOpen] = useState(false);
  // Fica guardado depois de fechar, para o diálogo não esvaziar enquanto sai da tela.
  const [target, setTarget] = useState<DeletionTarget | undefined>(undefined);

  const ask = (next: DeletionTarget): void => {
    setTarget(next);
    setOpen(true);
  };

  const fail = (error: unknown): void => {
    setOpen(false);
    toast.error(errorMessage(error));
  };

  const confirm = (): void => {
    if (target?.kind === "one") {
      const { id } = target.conversation;
      deleteOne.mutate(id, {
        onSuccess: () => {
          setOpen(false);
          toast.success("Conversa apagada.");
          if (id === currentId) onCurrentDeleted();
        },
        onError: fail,
      });
    } else if (target?.kind === "all") {
      deleteAll.mutate(undefined, {
        onSuccess: () => {
          setOpen(false);
          toast.success("Histórico de conversas apagado.");
          onAllDeleted?.();
          if (currentId) onCurrentDeleted();
        },
        onError: fail,
      });
    }
  };

  const dialog = target && (
    <ConfirmDialog
      open={open}
      title={target.kind === "one" ? "Apagar esta conversa?" : "Apagar todas as conversas?"}
      description={
        target.kind === "one"
          ? `A conversa "${titleOf(target.conversation)}" deixa de existir, com as perguntas e as respostas dela. Seus lançamentos não mudam.`
          : "Todo o histórico do assistente deixa de existir. Seus lançamentos não mudam."
      }
      confirmLabel={target.kind === "one" ? "Apagar conversa" : "Apagar todas"}
      loading={deleteOne.isPending || deleteAll.isPending}
      onConfirm={confirm}
      onCancel={() => setOpen(false)}
    />
  );

  return { ask, dialog };
}
