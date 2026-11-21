// Painel provisório, até a US5 (T093) trazer os números do mês.
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";

export default function DashboardScreen() {
  return (
    <Screen title="Painel">
      <Text variant="body" color="inkMuted">
        Você entrou no Contaí. O resumo do mês chega aqui em breve.
      </Text>
    </Screen>
  );
}
