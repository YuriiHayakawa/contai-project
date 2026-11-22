import { Stack } from "expo-router";

import { RequireSession } from "@/features/auth/components/RequireSession";
import { fontFamily } from "@/theme/fonts";
import { useTheme } from "@/theme/useTheme";

export default function AppLayout() {
  const { colors } = useTheme();
  // As telas fora das abas têm cabeçalho com "Voltar"; as abas têm o próprio título.
  const withHeader = {
    headerShown: true,
    headerBackTitle: "Voltar",
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.bg },
    headerTitleStyle: { color: colors.ink, fontFamily: fontFamily("body", "700") },
    headerShadowVisible: false,
  };
  return (
    <RequireSession>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen
          name="lancamento/novo"
          options={{ ...withHeader, title: "Novo lançamento" }}
        />
        <Stack.Screen name="lancamento/[id]" options={{ ...withHeader, title: "Lançamento" }} />
        <Stack.Screen name="siri/index" options={{ ...withHeader, title: "Conectar à Siri" }} />
        <Stack.Screen name="siri/novo-token" options={{ ...withHeader, title: "Novo token" }} />
        <Stack.Screen name="assistente/[id]" options={{ ...withHeader, title: "Assistente" }} />
      </Stack>
    </RequireSession>
  );
}
