import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import type { ChatMessage } from "../types";
import { ProposalCard } from "./ProposalCard";

/** O texto da resposta em três partes, com o valor principal (`highlight`) no meio. */
export function splitHighlight(
  content: string,
  highlight: string | null,
): { before: string; highlight: string | null; after: string } {
  const at = highlight ? content.indexOf(highlight) : -1;
  if (!highlight || at === -1) return { before: content, highlight: null, after: "" };
  return {
    before: content.slice(0, at),
    highlight,
    after: content.slice(at + highlight.length),
  };
}

/**
 * Uma mensagem da conversa (design-system, seção 8). A pergunta fica num balão à direita; a
 * resposta, escrita direto sobre o fundo, com o valor principal em destaque e, no lançamento
 * por texto, a proposta para conferir.
 */
export function MessageBubble({ message }: { message: ChatMessage }) {
  const { colors } = useTheme();

  if (message.role === "user") {
    return (
      <View
        style={[styles.user, { backgroundColor: colors.primarySoft }]}
        accessible
        accessibilityLabel={`Você perguntou: ${message.content}`}
      >
        <Text variant="body">{message.content}</Text>
      </View>
    );
  }

  const parts = splitHighlight(message.content, message.highlight);
  return (
    <View style={styles.assistant}>
      <Text variant="label" color="inkMuted">
        Contaí
      </Text>
      <Text variant="body" accessibilityLabel={`Contaí respondeu: ${message.content}`}>
        {parts.before}
        {parts.highlight && (
          <Text variant="bodyStrong" style={{ backgroundColor: colors.highlight }}>
            {parts.highlight}
          </Text>
        )}
        {parts.after}
      </Text>
      {message.kind === "transaction_proposal" && message.proposal && (
        <ProposalCard messageId={message.id} proposal={message.proposal} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  assistant: { gap: space[2] },
});
