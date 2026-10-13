import { useState } from "react";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import type { SessionInfo } from "../../auth/types";
import { useEndOtherSessions, useEndSession, useSessions } from "../hooks/useSessions";
import { SettingsSection } from "./SettingsSection";

function lastUsedLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface SessionRowProps {
  session: SessionInfo;
  onEnd: (id: string) => void;
  ending: boolean;
}

function SessionRow({ session, onEnd, ending }: SessionRowProps) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-body font-bold text-ink">{session.device}</p>
        <p className="text-label text-ink-muted">Última atividade: {lastUsedLabel(session.last_used_at)}</p>
      </div>
      {session.is_current ? (
        <span className="shrink-0 rounded-sm bg-primary-soft px-2 py-1 text-label font-bold text-primary">
          Este aparelho
        </span>
      ) : (
        <Button variant="ghost" size="compact" loading={ending} onClick={() => onEnd(session.id)}>
          Encerrar
        </Button>
      )}
    </li>
  );
}

/** Dispositivos conectados: a sessão atual fica marcada; dá para encerrar uma ou todas as outras. */
export function SessionsSection() {
  const sessions = useSessions();
  const endOne = useEndSession();
  const endOthers = useEndOtherSessions();
  const toast = useToast();
  const [confirmingEndOthers, setConfirmingEndOthers] = useState(false);

  const items = sessions.data ?? [];
  const hasOthers = items.some((session) => !session.is_current);

  const endSession = (id: string): void => {
    endOne.mutate(id, { onSuccess: () => toast.success("Sessão encerrada.") });
  };

  const endAllOthers = (): void => {
    endOthers.mutate(undefined, {
      onSuccess: () => {
        toast.success("As outras sessões foram encerradas.");
        setConfirmingEndOthers(false);
      },
    });
  };

  return (
    <SettingsSection description="Aparelhos e navegadores onde sua conta está aberta.">

      {sessions.isPending && (
        <div role="status" className="grid gap-3">
          <span className="sr-only">Carregando as sessões…</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      )}

      {sessions.isError && (
        <EmptyState
          kind="error"
          title="Não foi possível carregar as sessões"
          description={errorMessage(sessions.error)}
          onAction={() => void sessions.refetch()}
        />
      )}

      {sessions.data && (
        <div className="grid gap-4">
          {endOne.isError && <Notice kind="error">{errorMessage(endOne.error)}</Notice>}
          <ul className="divide-y divide-border">
            {items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onEnd={endSession}
                ending={endOne.isPending && endOne.variables === session.id}
              />
            ))}
          </ul>
          {hasOthers && (
            <div className="justify-self-start">
              <Button variant="secondary" onClick={() => setConfirmingEndOthers(true)}>
                Encerrar as outras sessões
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmingEndOthers}
        title="Encerrar as outras sessões?"
        description="Você continua conectado neste aparelho. Os outros precisarão entrar de novo."
        confirmLabel="Encerrar as outras"
        onConfirm={endAllOthers}
        onCancel={() => setConfirmingEndOthers(false)}
        loading={endOthers.isPending}
      />
    </SettingsSection>
  );
}
