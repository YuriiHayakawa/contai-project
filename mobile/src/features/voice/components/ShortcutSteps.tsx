// Passo a passo para montar o atalho "Contaí" no app Atalhos (contracts/siri-shortcut.md e
// research, seção 10). Os nomes das ações são os do iPhone em português.
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { getConfig } from "@/lib/config";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { SIRI_URL } from "../types";

const STEPS: { title: string; detail: string }[] = [
  {
    title: "Crie o atalho",
    detail:
      'Abra o app Atalhos, toque em "+" e dê ao atalho o nome "Contaí". É o nome que você vai dizer depois de "E aí Siri".',
  },
  {
    title: 'Adicione "Ditar texto"',
    detail: 'Em idioma, escolha Português (Brasil). Como pergunta, escreva "O que você gastou?".',
  },
  {
    title: 'Adicione "Obter conteúdo de URL"',
    detail: `Use o endereço ${SIRI_URL}. Toque em "Mostrar Mais" e escolha o método POST.`,
  },
  {
    title: "Coloque o cabeçalho com o token",
    detail:
      'Em "Cabeçalhos", adicione a chave Authorization. No valor, escreva Bearer, um espaço e cole o token.',
  },
  {
    title: "Coloque a frase no corpo",
    detail:
      'Em "Corpo da Solicitação", escolha JSON. Adicione um campo de texto com a chave phrase e, como valor, a variável "Texto Ditado".',
  },
  {
    title: 'Adicione "Obter Valor do Dicionário"',
    detail: "Use a chave speech: é a resposta que o Contaí manda para a Siri ler.",
  },
  {
    title: 'Adicione "Mostrar Resultado"',
    detail: 'Mostre o "Valor do Dicionário". A Siri lê esse texto em voz alta.',
  },
  {
    title: "Teste",
    detail:
      'Diga "E aí Siri, Contaí" e depois um gasto, como "gastei 45 no iFood no cartão". Ele aparece no app em destaque, e um toque desfaz.',
  },
];

/** O passo a passo manual, com o atalho pronto antes quando houver o link do iCloud. */
export function ShortcutSteps() {
  const { colors } = useTheme();
  const toast = useToast();
  const shortcutUrl = getConfig().shortcutUrl;

  return (
    <View style={styles.wrapper}>
      {shortcutUrl && (
        <View style={styles.group}>
          <Button
            label="Instalar o atalho"
            accessibilityHint="Abre o atalho pronto no app Atalhos. Ele vai pedir o token."
            onPress={() => void Linking.openURL(shortcutUrl)}
          />
          <Text variant="small" color="inkMuted">
            Ao instalar, o Atalhos pede o token: cole o que você copiou. Se preferir montar à mão,
            siga os passos abaixo.
          </Text>
        </View>
      )}
      <Text variant="title3" accessibilityRole="header">
        Montar o atalho à mão
      </Text>
      {STEPS.map((step, index) => (
        <View
          key={step.title}
          accessible
          style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="bodyStrong">
            {index + 1}. {step.title}
          </Text>
          <Text variant="body" color="inkMuted">
            {step.detail}
          </Text>
        </View>
      ))}
      <Button
        variant="secondary"
        label="Copiar o endereço do atalho"
        onPress={() => {
          void Clipboard.setStringAsync(SIRI_URL);
          toast.show({ message: "Endereço copiado.", kind: "success" });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[3] },
  group: { gap: space[2] },
  step: { borderWidth: 1, borderRadius: radius.md, padding: space[3], gap: space[1] },
});
