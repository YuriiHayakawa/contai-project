// Desfazer e Refazer dos lançamentos por voz (contracts/rest-api.md, "Transações").
import type { Transaction, UndoVoiceResult } from "@web/features/transactions/types";

import { api } from "@/lib/api-client";

/** Apaga o lançamento por voz, sem confirmação, e devolve o token do "Refazer". */
export function undoVoice(id: string): Promise<UndoVoiceResult> {
  return api.post<UndoVoiceResult>(`/transactions/${id}/undo-voice`);
}

/** Reinsere o lançamento desfeito, igual ao que era, com o mesmo id. */
export function restoreTransaction(restoreToken: string): Promise<Transaction> {
  return api.post<Transaction>("/transactions/restore", { restore_token: restoreToken });
}
