import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useCreateTransaction } from "../../transactions/hooks/useCreateTransaction";
import { useNewTransaction } from "../../transactions/hooks/useNewTransaction";
import type { Transaction, TransactionPreset } from "../../transactions/types";
import { discardProposal, markProposalSaved } from "../services/assistantService";
import type { ConversationDetail, Proposal } from "../types";
import { assistantQueryKey } from "./useConversation";

interface SavedVariables {
  messageId: string;
  transaction: Transaction;
}

/** A conta e a categoria da proposta que ainda servem a um lançamento novo. */
export interface ProposalChoices {
  accountId: string | null;
  categoryId: string | null;
}

/** Uma proposta com tudo o que um lançamento precisa: pode ser salva sem passar pelo formulário. */
export interface CompleteChoices {
  accountId: string;
  categoryId: string;
}

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

interface SaveOptions {
  /** O lançamento não foi gravado: a proposta continua à espera. */
  onError: (error: unknown) => void;
}

/**
 * Salvar uma proposta do assistente (FR-066, FR-067). Nada é salvo antes de o usuário pedir:
 * `save` grava a proposta como está, quando ela já tem conta e categoria, e `review` abre o
 * formulário de lançamento preenchido, para ajustar antes de salvar. Nos dois caminhos o
 * lançamento nasce com `source = assistant` e a proposta fica marcada como salva.
 */
export function useSaveProposal() {
  const queryClient = useQueryClient();
  const openNewTransaction = useNewTransaction();
  const create = useCreateTransaction();

  const saved = useMutation({
    mutationFn: ({ messageId, transaction }: SavedVariables) =>
      markProposalSaved(messageId, transaction.id),
    // O lançamento já existe: o cartão mostra "Lançamento salvo" sem esperar esta chamada.
    onMutate: ({ messageId, transaction }) => {
      updateProposal(queryClient, messageId, (proposal) => savedProposal(proposal, transaction));
    },
  });

  const review = (messageId: string, proposal: Proposal, choices: ProposalChoices): void => {
    const preset: TransactionPreset = {
      type: proposal.type,
      amountCents: proposal.amount_cents,
      description: proposal.description,
      date: proposal.date,
      accountId: choices.accountId,
      categoryId: choices.categoryId ?? undefined,
      source: "assistant",
      onSaved: (transaction) => saved.mutate({ messageId, transaction }),
    };
    openNewTransaction(preset);
  };

  const save = (
    messageId: string,
    proposal: Proposal,
    choices: CompleteChoices,
    { onError }: SaveOptions,
  ): void => {
    create.mutate(
      {
        type: proposal.type,
        amount_cents: proposal.amount_cents,
        date: proposal.date,
        description: proposal.description,
        account_id: choices.accountId,
        category_id: choices.categoryId,
        notes: null,
        source: "assistant",
      },
      { onSuccess: (transaction) => saved.mutate({ messageId, transaction }), onError },
    );
  };

  return { review, save, isSaving: create.isPending };
}

/** Descarta uma proposta: nada é salvo, e o cartão passa a dizer que ela foi descartada. */
export function useDiscardProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => discardProposal(messageId),
    onSuccess: (_, messageId) => {
      updateProposal(queryClient, messageId, (proposal) => ({ ...proposal, status: "discarded" }));
    },
  });
}
