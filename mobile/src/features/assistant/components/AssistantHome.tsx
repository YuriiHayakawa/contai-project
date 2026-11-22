import { dateTimeLabel } from "@web/lib/dates";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api-client";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { useConversations, useDeleteConversation } from "../hooks/useConversations";
import type { Conversation } from "../types";

const UNTITLED = "Conversa sem pergunta";

function titleOf(conversation: Conversation): string {
  return conversation.title || UNTITLED;
}

/** O histórico do assistente, compartilhado com o site (FR-012), e o começo de uma conversa. */
export function AssistantHome() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const conversations = useConversations();
  const remove = useDeleteConversation();
  const pull = usePullToRefresh(conversations.refetch);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  useRefetchOnFocus(conversations.refetch);

  let list;
  if (conversations.isPending) {
    list = <LoadingState message="Carregando as conversas…" />;
  } else if (conversations.error) {
    list = (
      <ErrorState
        message={errorMessage(conversations.error)}
        onRetry={() => void conversations.refetch()}
      />
    );
  } else if (conversations.items.length === 0) {
    list = (
      <EmptyState
        title="Nenhuma conversa ainda"
        description="Pergunte quanto gastou, em que categoria, ou escreva um gasto para lançar."
      />
    );
  } else {
    list = (
      <View style={styles.list}>
        {conversations.items.map((conversation) => (
          <View
            key={conversation.id}
            style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${titleOf(conversation)}, ${dateTimeLabel(conversation.updated_at)}`}
              accessibilityHint="Abre a conversa."
              onPress={() => router.push(`/assistente/${conversation.id}`)}
              style={styles.open}
            >
              <Text variant="bodyStrong">{titleOf(conversation)}</Text>
              <Text variant="small" color="inkMuted">
                {dateTimeLabel(conversation.updated_at)}
              </Text>
            </Pressable>
            <Button
              compact
              variant="ghost"
              label="Apagar"
              accessibilityLabel={`Apagar a conversa ${titleOf(conversation)}`}
              onPress={() => setDeleting(conversation)}
            />
          </View>
        ))}
        {conversations.hasNextPage && (
          <Button
            variant="secondary"
            label="Ver conversas mais antigas"
            loading={conversations.isFetchingNextPage}
            onPress={() => void conversations.fetchNextPage()}
          />
        )}
      </View>
    );
  }

  return (
    <Screen title="Assistente" refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <Button label="Nova conversa" onPress={() => router.push("/assistente/nova")} />
      {list}
      <ConfirmDialog
        open={deleting !== null}
        title="Apagar esta conversa?"
        description={`A conversa "${deleting ? titleOf(deleting) : ""}" deixa de existir, com as perguntas e as respostas dela, no app e no site. Seus lançamentos não mudam.`}
        confirmLabel="Apagar conversa"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => toast.show({ message: "Conversa apagada.", kind: "success" }),
            onError: (error) => toast.show({ message: errorMessage(error), kind: "error" }),
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[2] },
  row: {
    borderWidth: 1,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: space[2],
  },
  open: { flex: 1, padding: space[4], gap: space[1] },
});
