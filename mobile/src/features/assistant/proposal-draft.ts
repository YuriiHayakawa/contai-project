// O "Ajustar" de uma proposta: os valores vão para o formulário de lançamento novo, e a mensagem
// fica guardada para marcar a proposta como salva quando o lançamento for gravado. Fica só em
// memória e é lido uma vez, ao abrir o formulário.
import type { EntryType } from "@web/features/transactions/types";

export interface ProposalDraft {
  messageId: string;
  values: {
    type: EntryType;
    amountCents: number;
    description: string;
    date: string;
    /** `null`: a frase não deixou claro, e o usuário escolhe no formulário. */
    accountId: string | null;
    categoryId: string | null;
  };
}

let draft: ProposalDraft | null = null;

export function setProposalDraft(value: ProposalDraft): void {
  draft = value;
}

/** Devolve o rascunho e o apaga: ele vale para um formulário só. */
export function takeProposalDraft(): ProposalDraft | null {
  const taken = draft;
  draft = null;
  return taken;
}
