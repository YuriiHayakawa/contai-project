import { Stack } from "expo-router";

import { RequireSession } from "@/features/auth/components/RequireSession";

export default function AppLayout() {
  return (
    <RequireSession>
      <Stack screenOptions={{ headerShown: false }} />
    </RequireSession>
  );
}
