import { useLocalSearchParams } from "expo-router";

import { ConversationView } from "@/features/assistant/components/ConversationView";

/** `nova` é uma conversa que ainda não existe: ela nasce com a primeira pergunta. */
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ConversationView conversationId={id === "nova" ? null : id} />;
}
