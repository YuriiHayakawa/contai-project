// Raiz do app: fontes (com a tela de abertura até carregarem), tema, cache de consultas em
// memória, sessão, toasts e o aviso de servidor acordando. As rotas só compõem telas.
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "@/components/ui/Toast";
import { WakingBanner } from "@/components/ui/WakingBanner";
import { SessionProvider } from "@/features/auth/SessionProvider";
import { bindAppFocus, createQueryClient } from "@/lib/query-client";
import { useAppFonts } from "@/theme/fonts";
import { useTheme } from "@/theme/useTheme";

void SplashScreen.preventAutoHideAsync();
bindAppFocus();

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const theme = useTheme();
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ToastProvider>
            <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
            <WakingBanner />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.bg },
              }}
            />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
