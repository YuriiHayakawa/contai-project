import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useAuth } from "../../auth/hooks/useAuth";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import { ThemeSection } from "./ThemeSection";
import { TwoFactorSection } from "./TwoFactorSection";

/** Configurações da conta: perfil, senha, verificação em duas etapas, sessões e aparência. */
export function SettingsPage() {
  const { user } = useAuth();

  return (
    <PageContent>
      <PageHeader title="Configurações" />
      {user ? (
        <div className="grid gap-8">
          <ProfileSection user={user} />
          <PasswordSection />
          <TwoFactorSection user={user} />
          <SessionsSection />
          <ThemeSection />
        </div>
      ) : (
        <div role="status" className="grid gap-4">
          <span className="sr-only">Carregando…</span>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
    </PageContent>
  );
}
