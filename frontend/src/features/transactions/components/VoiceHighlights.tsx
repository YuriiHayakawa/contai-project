import { Undo2 } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { dayLabel } from "../../../lib/dates";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import { categoriesById, useCategories } from "../../categories/hooks/useCategories";
import { useUndoVoice } from "../hooks/useUndoVoice";
import { useVoiceHighlights } from "../hooks/useVoiceHighlights";
import { signedAmount } from "./TransactionList";
import { VoiceBadge, voicePhraseLabel } from "./VoiceBadge";

/**
 * "Lançados por voz", no topo do painel (US4): os lançamentos da Siri dos últimos 7 dias, com a
 * frase entendida e o "Desfazer" de um toque. Sem nenhum, o bloco não aparece.
 */
export function VoiceHighlights() {
  const highlights = useVoiceHighlights();
  const accounts = useAccounts();
  const categories = useCategories();
  const undo = useUndoVoice();

  const items = highlights.data ?? [];
  if (items.length === 0) return null;

  const accountNames = new Map((accounts.data ?? []).map((account) => [account.id, account.name]));
  const categoryLabels = categories.data ? categoriesById(categories.data) : new Map();

  return (
    <Card>
      <section aria-labelledby="voice-highlights-title" className="grid gap-3">
        <h2 id="voice-highlights-title" className="text-title-3 font-bold text-ink">
          Lançados por voz
        </h2>
        <ul className="divide-y divide-border">
          {items.map((transaction) => {
            const details = [
              transaction.category_id ? categoryLabels.get(transaction.category_id)?.label : null,
              accountNames.get(transaction.account_id),
              dayLabel(transaction.date),
            ].filter(Boolean);
            return (
              <li key={transaction.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-body font-bold text-ink">
                    <span className="wrap-break-word">{transaction.description}</span>
                    <VoiceBadge />
                  </p>
                  <p className="text-small text-ink-muted">{details.join(" · ")}</p>
                  {transaction.voice_phrase && (
                    <p className="wrap-break-word text-small text-ink-muted italic">
                      {voicePhraseLabel(transaction.voice_phrase)}
                    </p>
                  )}
                </div>
                <span
                  className={
                    transaction.type === "income"
                      ? "money text-money-md text-income"
                      : "money text-money-md"
                  }
                >
                  {signedAmount(transaction)}
                </span>
                <Button
                  variant="ghost"
                  size="compact"
                  icon={<Undo2 />}
                  aria-label={`Desfazer ${transaction.description}`}
                  loading={undo.isPending && undo.variables?.id === transaction.id}
                  onClick={() => undo.mutate(transaction)}
                >
                  Desfazer
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
