import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

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

/**
 * Conferir e salvar uma proposta do assistente (FR-066, FR-067). `review` abre o formulário de
 * lançamento preenchido com a proposta; nada é salvo até o usuário confirmar nele. Quando ele
 * salva, o lançamento nasce com `source = assistant` e a proposta fica marcada como salva.
 */
export function useSaveProposal() {
  const queryClient = useQueryClient();
  const openNewTransaction = useNewTransaction();

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

  return { review };
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
