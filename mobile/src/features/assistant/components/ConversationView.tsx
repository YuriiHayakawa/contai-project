import { useRouter } from "expo-router";
import { type ComponentRef, useEffect, useRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { errorMessage } from "@/lib/api-client";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { isLimitReached, useAsk } from "../hooks/useAsk";
import { useConversation } from "../hooks/useConversation";
import { useAssistantUsage } from "../hooks/useConversations";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";

export const WAITING_MESSAGE = "Preparando a resposta…";

/**
 * Uma conversa com o assistente (US6). Enquanto a resposta não chega, mostra que ela está sendo
 * preparada; a pessoa pode sair da tela, e a resposta fica na conversa. Se a pergunta falha, ela
 * continua na tela com "Tentar de novo", porque o servidor não grava pergunta sem resposta.
 */
export function ConversationView({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const ask = useAsk();
  // Numa conversa nova, o id chega com a primeira resposta.
  const activeId = conversationId ?? ask.data?.conversationId ?? null;
  const conversation = useConversation(activeId);
  const usage = useAssistantUsage();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const answeredId = ask.data?.conversationId;
  useEffect(() => {
    if (conversationId === null && answeredId) router.setParams({ id: answeredId });
  }, [answeredId, conversationId, router]);

  const messages = conversation.data?.messages ?? [];
  const pending = ask.isPending || (ask.isError && !isLimitReached(ask.error));
  const question = pending ? ask.variables?.content : undefined;

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages.length, question]);

  const send = (content: string): void => ask.mutate({ conversationId: activeId, content });

  let body;
  if (activeId !== null && conversation.isPending) {
    body = <LoadingState message="Abrindo a conversa…" />;
  } else if (conversation.error) {
    body = (
      <ErrorState
        title="Não foi possível abrir a conversa"
        message={errorMessage(conversation.error)}
        onRetry={() => void conversation.refetch()}
      />
    );
  } else {
    body = (
      <>
        {messages.length === 0 && !question && (
          <Text variant="body" color="inkMuted">
            Pergunte sobre os seus gastos, ou escreva um gasto para lançar, como “almoço 32,50 no
            cartão”.
          </Text>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {question && (
          <View
            style={[styles.question, { backgroundColor: colors.primarySoft }]}
            accessible
            accessibilityLabel={`Você perguntou: ${question}`}
          >
            <Text variant="body">{question}</Text>
          </View>
        )}
        {ask.isPending && <LoadingState message={WAITING_MESSAGE} />}
        {ask.isError && !isLimitReached(ask.error) && (
          <View style={styles.failed}>
            <Notice kind="error">{errorMessage(ask.error)}</Notice>
            {ask.variables && (
              <Button
                variant="secondary"
                label="Tentar de novo"
                onPress={() => ask.variables && send(ask.variables.content)}
              />
            )}
          </View>
        )}
      </>
    );
  }

  return (
    <SafeAreaView
      edges={["left", "right", "bottom"]}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={96}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <Composer usage={usage.data} sending={ask.isPending} onSend={send} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  messages: { padding: space[4], gap: space[4] },
  question: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  failed: { gap: space[2] },
  composer: { borderTopWidth: 1, padding: space[4] },
});
