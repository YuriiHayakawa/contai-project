import { addDays, today } from "@web/lib/dates";
import { useQuery } from "@tanstack/react-query";

import { listTransactions } from "../services/transactions";
import { transactionsQueryKey } from "./useTransactions";

/** Quantos dias o bloco "Lançados por voz" mostra, contando hoje. */
export const VOICE_HIGHLIGHT_DAYS = 7;

/** O que a Siri lançou nos últimos 7 dias, com hoje no fuso de Brasília. */
export function useVoiceHighlights() {
  const from = addDays(today(), -(VOICE_HIGHLIGHT_DAYS - 1));
  return useQuery({
    queryKey: [...transactionsQueryKey, "voice", from],
    queryFn: async ({ signal }) =>
      (await listTransactions({ source: "voice", from }, null, signal)).items,
  });
}
