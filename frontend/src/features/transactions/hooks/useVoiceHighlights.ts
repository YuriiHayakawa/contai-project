import { useQuery } from "@tanstack/react-query";

import { addDays, today } from "../../../lib/dates";
import { listTransactions } from "../services/transactionsService";
import { transactionsQueryKey } from "./useTransactions";

/** Quantos dias o bloco "Lançados por voz" mostra, contando hoje. */
export const VOICE_HIGHLIGHT_DAYS = 7;

/** Os lançamentos que a Siri fez nos últimos 7 dias, com hoje no fuso de Brasília. */
export function useVoiceHighlights() {
  const from = addDays(today(), -(VOICE_HIGHLIGHT_DAYS - 1));
  return useQuery({
    queryKey: [...transactionsQueryKey, "voice", from],
    queryFn: async () => (await listTransactions({ source: "voice", from }, null)).items,
  });
}
