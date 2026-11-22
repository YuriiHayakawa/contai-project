import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Transaction } from "@web/features/transactions/types";
import { useRouter } from "expo-router";

import { useSaveTransaction } from "../../transactions/hooks/useSaveTransaction";
import { setProposalDraft } from "../proposal-draft";
import { discardProposal, markProposalSaved } from "../services/assistant";
import type { ConversationDetail, Proposal } from "../types";
import { assistantQueryKey } from "./useConversations";

/** Troca a proposta de uma mensagem em todas as conversas guardadas na tela. */
function updateProposal(
  queryClient: QueryClient,
  messageId: string,
  change: (proposal: Proposal) => Proposal,
): void {
  queryClient.setQueriesData<ConversationDetail>(
    { queryKey: [...assistantQueryKey, "conversation"] },
    (conversation) =>
      conversation && {
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId && message.proposal
            ? { ...message, proposal: change(message.proposal) }
            : message,
        ),
      },
  );
}

/** A proposta como o servidor a guarda depois de salva: com os campos do lançamento gravado. */
function savedProposal(proposal: Proposal, transaction: Transaction): Proposal {
  const saved: Proposal = { ...proposal, status: "saved", transaction_id: transaction.id };
  if (transaction.type === "transfer") return saved;
  return {
    ...saved,
    type: transaction.type,
    amount_cents: transaction.amount_cents,
    date: transaction.date,
    description: transaction.description,
    account_id: transaction.account_id,
    category_id: transaction.category_id,
  };
}

/** Marca a proposta como salva, na tela na hora e no servidor em seguida. */
export function useMarkProposalSaved() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, transaction }: { messageId: string; transaction: Transaction }) =>
      markProposalSaved(messageId, transaction.id),
    onMutate: ({ messageId, transaction }) => {
      updateProposal(queryClient, messageId, (proposal) => savedProposal(proposal, transaction));
    },
  });
}

export interface ProposalChoices {
  accountId: string | null;
  categoryId: string | null;
}

/**
 * Salvar, ajustar ou descartar uma proposta do assistente (FR-012). Nada é salvo antes de o
 * usuário pedir. "Salvar" grava a proposta como está, quando ela tem conta e categoria;
 * "Ajustar" abre o formulário preenchido. Nos dois, o lançamento nasce com `source = assistant`.
 */
export function useProposalActions(messageId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useSaveTransaction();
  const markSaved = useMarkProposalSaved();

  const discard = useMutation({
    mutationFn: () => discardProposal(messageId),
    onSuccess: () => {
      updateProposal(queryClient, messageId, (proposal) => ({ ...proposal, status: "discarded" }));
    },
  });

  const save = (
    proposal: Proposal,
    choices: { accountId: string; categoryId: string },
    onSaved?: () => void,
  ) => {
    create.mutate(
      {
        input: {
          type: proposal.type,
          amount_cents: proposal.amount_cents,
          date: proposal.date,
          description: proposal.description,
          account_id: choices.accountId,
          category_id: choices.categoryId,
          notes: null,
          source: "assistant",
        },
      },
      {
        onSuccess: (transaction) => {
          markSaved.mutate({ messageId, transaction });
          onSaved?.();
        },
      },
    );
  };

  const adjust = (proposal: Proposal, choices: ProposalChoices) => {
    setProposalDraft({
      messageId,
      values: {
        type: proposal.type,
        amountCents: proposal.amount_cents,
        description: proposal.description,
        date: proposal.date,
        accountId: choices.accountId,
        categoryId: choices.categoryId,
      },
    });
    router.push("/lancamento/novo");
  };

  return { save, adjust, discard, saving: create.isPending, saveError: create.error };
}
