import { dateTimeLabel } from "@web/lib/dates";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { space } from "@/theme/tokens";

import { type AssistantUsage, MAX_QUESTION_LENGTH } from "../types";

export interface ComposerProps {
  usage: AssistantUsage | undefined;
  sending: boolean;
  onSend: (content: string) => void;
}

/**
 * O campo da pergunta. Com 5 perguntas ou menos, avisa quantas restam; no limite do dia, dá
 * lugar ao aviso de quando o assistente volta, com a mesma frase do site (FR-071).
 */
export function Composer({ usage, sending, onSend }: ComposerProps) {
  const [text, setText] = useState("");

  if (usage && usage.remaining <= 0) {
    return (
      <Notice kind="info">
        {`Você atingiu o limite de perguntas de hoje. O assistente volta em ${dateTimeLabel(usage.resets_at)}; o restante do Contaí continua funcionando.`}
      </Notice>
    );
  }

  const send = (): void => {
    const content = text.trim();
    if (!content || sending) return;
    onSend(content);
    setText("");
  };

  return (
    <View style={styles.wrapper}>
      {usage && usage.remaining <= 5 && (
        <Text variant="small" color="inkMuted">
          {usage.remaining === 1
            ? "Resta 1 pergunta hoje."
            : `Restam ${usage.remaining} perguntas hoje.`}
        </Text>
      )}
      <TextField
        label="Pergunta ao assistente"
        placeholder="Por exemplo: quanto gastei com mercado este mês?"
        value={text}
        onChangeText={setText}
        maxLength={MAX_QUESTION_LENGTH}
        multiline
        editable={!sending}
      />
      <Button label="Enviar pergunta" loading={sending} onPress={send} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[2] },
});
