import { MonitorSmartphone, ShieldCheck, ShieldOff, SunMoon, UserRound } from "lucide-react";
import { useState } from "react";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Skeleton } from "../../../components/ui/Skeleton";
import { cn } from "../../../lib/cn";
import type { CurrentUser } from "../../auth/types";
import { useAuth } from "../../auth/hooks/useAuth";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import { SettingsLayout, type SettingsGroup } from "./SettingsLayout";
import { ThemeSection } from "./ThemeSection";
import { TwoFactorSection } from "./TwoFactorSection";

const SECURITY_ID = "seguranca";

/** Iniciais do nome para o avatar: a primeira letra do primeiro e do último nome. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0)?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function IdentityHeader({
  user,
  onManageSecurity,
}: {
  user: CurrentUser;
  onManageSecurity: () => void;
}) {
  const enabled = user.two_factor_enabled;
  const Icon = enabled ? ShieldCheck : ShieldOff;
  return (
    <div className="mb-8 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="grid size-14 shrink-0 place-items-center rounded-full bg-primary font-display text-title-2 font-bold text-on-primary">
        {initials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-title-3 font-bold text-ink">{user.name}</p>
        <p className="truncate text-body text-ink-muted">{user.email}</p>
      </div>
      <button
        type="button"
        onClick={onManageSecurity}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label font-bold",
          "transition-colors duration-fast ease-out",
          enabled
            ? "bg-income-soft text-income hover:brightness-95"
            : "bg-warning-soft text-warning hover:brightness-95",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
        {enabled ? "Em duas etapas" : "Proteja com duas etapas"}
      </button>
    </div>
  );
}

/** Configurações da conta: perfil, segurança, dispositivos e aparência, num painel de duas colunas. */
export function SettingsPage() {
  const { user } = useAuth();
  const [active, setActive] = useState("perfil");

  if (!user) {
    return (
      <PageContent>
        <PageHeader title="Configurações" />
        <div role="status" className="grid gap-4">
          <span className="sr-only">Carregando…</span>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContent>
    );
  }

  const groups: SettingsGroup[] = [
    {
      id: "perfil",
      label: "Perfil",
      icon: UserRound,
      content: <ProfileSection user={user} />,
    },
    {
      id: SECURITY_ID,
      label: "Segurança",
      icon: ShieldCheck,
      content: (
        <>
          <TwoFactorSection user={user} />
          <PasswordSection />
        </>
      ),
    },
    {
      id: "dispositivos",
      label: "Dispositivos",
      icon: MonitorSmartphone,
      content: <SessionsSection />,
    },
    {
      id: "aparencia",
      label: "Aparência",
      icon: SunMoon,
      content: <ThemeSection />,
    },
  ];

  return (
    <PageContent>
      <PageHeader title="Configurações" />
      <IdentityHeader user={user} onManageSecurity={() => setActive(SECURITY_ID)} />
      <SettingsLayout groups={groups} active={active} onSelect={setActive} />
    </PageContent>
  );
}
