import * as Clipboard from "expo-clipboard";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { ShortcutSteps } from "./ShortcutSteps";

export interface NewTokenResultProps {
  token: string;
  onDone: () => void;
}

/**
 * O token recém-criado, que só aparece aqui (FR-017). Ao sair da tela, a área de transferência
 * é limpa se ainda tiver o token, para ele não ficar por lá.
 */
export function NewTokenResult({ token, onDone }: NewTokenResultProps) {
  const { colors } = useTheme();
  const toast = useToast();

  useEffect(
    () => () => {
      void Clipboard.getStringAsync().then((content) => {
        if (content === token) void Clipboard.setStringAsync("");
      });
    },
    [token],
  );

  return (
    <View style={styles.wrapper}>
      <Notice kind="warning">
        Este token só aparece agora. Copie e cole no atalho antes de sair desta tela.
      </Notice>
      <View style={[styles.token, { backgroundColor: colors.bgSunken }]}>
        <Text variant="body" selectable accessibilityLabel="Token da Siri">
          {token}
        </Text>
      </View>
      <Button
        label="Copiar o token"
        onPress={() => {
          void Clipboard.setStringAsync(token);
          toast.show({ message: "Token copiado.", kind: "success" });
        }}
      />
      <ShortcutSteps />
      <Button variant="secondary" label="Concluir" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[4] },
  token: { borderRadius: radius.md, padding: space[3] },
});
