// Abas do app. Assistente entra com a US6, que sai no corte 2: a barra nunca mostra uma aba sem
// tela.
import { Tabs } from "expo-router/js-tabs";
import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { useTheme } from "@/theme/useTheme";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

function tabIcon(name: SymbolName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  };
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamily("body", "600") },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Painel", tabBarIcon: tabIcon("chart.bar") }} />
      <Tabs.Screen
        name="lancamentos"
        options={{ title: "Lançamentos", tabBarIcon: tabIcon("list.bullet") }}
      />
      <Tabs.Screen
        name="mais"
        options={{ title: "Mais", tabBarIcon: tabIcon("ellipsis.circle") }}
      />
    </Tabs>
  );
}
