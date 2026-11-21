import { Redirect, Stack } from "expo-router";

import { LoadingState } from "@/components/ui/LoadingState";
import { useSession } from "@/features/auth/SessionProvider";

/** Telas de entrada. Com a sessão aberta, leva ao painel. */
export default function AuthLayout() {
  const { status } = useSession();
  if (status === "signedIn") return <Redirect href="/" />;
  if (status === "loading") return <LoadingState message="Abrindo o Contaí…" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
