import {
  CircleAlert,
  CircleCheck,
  Clock,
  FileUp,
  Hourglass,
  LoaderCircle,
  Undo2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { dateTimeLabel, dayLabel, toISODate } from "../../../lib/dates";
import { importPath, importReviewPath, paths } from "../../../lib/paths";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import { useImports } from "../hooks/useImports";
import { useUndoImport } from "../hooks/useUndoImport";
import { isExpired, isWaitingForAi, isWorking, type Import } from "../types";
import { Seal, type SealTone } from "./Seal";

interface ImportRowProps {
  record: Import;
  accountName: string | undefined;
  onUndo: (record: Import) => void;
}

/** Como a importação aparece no histórico: a situação, a quantidade e o que dá para fazer. */
interface Situation {
  label: string;
  tone: SealTone;
  icon: LucideIcon;
  /** Quantidade de linhas ou de lançamentos, quando há o que contar. */
  count?: string;
  /** O prazo, ou o que fazer quando a importação falhou ou expirou. */
  note?: string;
  action?: { label: string; to: string } | "undo";
}

const lineCount = (count: number): string => (count === 1 ? "1 linha" : `${count} linhas`);
const entryCount = (count: number): string =>
  count === 1 ? "1 lançamento" : `${count} lançamentos`;

function situationOf(record: Import): Situation {
  const until = record.expires_at ? `até ${dateTimeLabel(record.expires_at)}` : undefined;
  if (isWorking(record.status)) {
    const waitingForAi = isWaitingForAi(record);
    return {
      label: waitingForAi ? "Aguardando o serviço de IA" : "Lendo o arquivo",
      tone: "info",
      icon: waitingForAi ? Hourglass : LoaderCircle,
      note: (waitingForAi && record.error_message) || undefined,
      action: { label: "Ver andamento", to: importPath(record.id) },
    };
  }
  if (record.status === "awaiting_mapping") {
    return {
      label: "Esperando as colunas",
      tone: "info",
      icon: Hourglass,
      note: until && `O arquivo fica guardado ${until}.`,
      action: { label: "Indicar colunas", to: importPath(record.id) },
    };
  }
  if (record.status === "awaiting_review") {
    return {
      label: "Esperando a revisão",
      tone: "info",
      icon: Hourglass,
      count: lineCount(record.item_count),
      note: until && `Disponível para revisão ${until}.`,
      action: { label: "Revisar", to: importReviewPath(record.id) },
    };
  }
  if (record.status === "completed") {
    return {
      label: "Concluída",
      tone: "success",
      icon: CircleCheck,
      count: entryCount(record.imported_count),
      action: "undo",
    };
  }
  if (record.status === "undone") {
    return {
      label: "Desfeita",
      tone: "neutral",
      icon: Undo2,
      count: `${entryCount(record.imported_count)} ${record.imported_count === 1 ? "removido" : "removidos"}`,
    };
  }
  // Uma importação expirada volta do servidor como falha, com a orientação de enviar de novo.
  return {
    label: isExpired(record) ? "Expirada" : "Não foi importada",
    tone: isExpired(record) ? "warning" : "danger",
    icon: isExpired(record) ? Clock : CircleAlert,
    note: record.error_message ?? "Nada foi salvo. Envie o arquivo de novo.",
    action: { label: "Enviar de novo", to: paths.importNew },
  };
}

function ImportRow({ record, accountName, onUndo }: ImportRowProps) {
  const navigate = useNavigate();
  const situation = situationOf(record);
  const { action } = situation;

  return (
    <li className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-5">
      <div className="grid min-w-0 gap-1">
        <h2 className="line-clamp-2 text-body font-bold wrap-anywhere text-ink">
          {record.original_filename}
        </h2>
        <p className="truncate text-small text-ink-muted">
          {dayLabel(toISODate(new Date(record.created_at)))}
          {accountName && ` · ${accountName}`}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink">
          <Seal tone={situation.tone} icon={situation.icon}>
            {situation.label}
          </Seal>
          {situation.count}
        </p>
        {situation.note && <p className="text-small text-ink-muted">{situation.note}</p>}
      </div>
      {action === "undo" ? (
        <Button variant="secondary" className="justify-self-start" onClick={() => onUndo(record)}>
          Desfazer
        </Button>
      ) : (
        action && (
          <Button
            variant="secondary"
            className="justify-self-start"
            onClick={() => void navigate(action.to)}
          >
            {action.label}
          </Button>
        )
      )}
    </li>
  );
}

/**
 * Histórico de importações (FR-051): data, arquivo, conta, quantidade e situação de cada uma.
 * Uma importação concluída pode ser desfeita inteira, com confirmação (FR-052); a que expirou
 * aparece como "Expirada", com a orientação de enviar o arquivo de novo (FR-083).
 */
export function ImportHistoryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const imports = useImports();
  const accounts = useAccounts();
  const undo = useUndoImport();
  const [undoOpen, setUndoOpen] = useState(false);
  // Fica guardada depois de fechar, para o diálogo não esvaziar enquanto sai da tela.
  const [undoing, setUndoing] = useState<Import | undefined>(undefined);

  const records = imports.data?.pages.flatMap((page) => page.items);
  const accountNames = new Map((accounts.data ?? []).map((account) => [account.id, account.name]));
  const upload = (): void => void navigate(paths.importNew);

  const confirmUndo = (record: Import): void => {
    undo.mutate(record.id, {
      onSuccess: () => {
        toast.success(
          `Importação desfeita: ${entryCount(record.imported_count)} ${record.imported_count === 1 ? "removido" : "removidos"}.`,
        );
        setUndoOpen(false);
      },
      onError: (error) => {
        setUndoOpen(false);
        toast.error(errorMessage(error));
      },
    });
  };

  const undoingAccount = undoing ? accountNames.get(undoing.account_id) : undefined;

  return (
    <PageContent>
      <PageHeader
        title="Importações"
        action={
          records &&
          records.length > 0 && (
            <Button icon={<Upload />} onClick={upload}>
              Importar arquivo
            </Button>
          )
        }
      />

      {imports.isPending && (
        <Card flush>
          <SkeletonList label="Carregando suas importações…" />
        </Card>
      )}

      {imports.isError && !records && (
        <EmptyState
          kind="error"
          title="Não foi possível carregar suas importações"
          description={errorMessage(imports.error)}
          onAction={() => void imports.refetch()}
        />
      )}

      {records?.length === 0 && (
        <EmptyState
          kind="first-time"
          icon={FileUp}
          title="Importe seu primeiro extrato"
          description="Envie o arquivo OFX, CSV ou a planilha do seu banco. Você revisa tudo antes de salvar."
          actionLabel="Importar arquivo"
          onAction={upload}
        />
      )}

      {records && records.length > 0 && (
        <Card flush>
          <ul>
            {records.map((record) => (
              <ImportRow
                key={record.id}
                record={record}
                accountName={accountNames.get(record.account_id)}
                onUndo={(target) => {
                  setUndoing(target);
                  setUndoOpen(true);
                }}
              />
            ))}
          </ul>
          {imports.hasNextPage && (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="secondary"
                loading={imports.isFetchingNextPage}
                onClick={() => void imports.fetchNextPage()}
              >
                Carregar mais
              </Button>
            </div>
          )}
        </Card>
      )}

      {undoing && (
        <ConfirmDialog
          open={undoOpen}
          title="Desfazer esta importação?"
          description={`${
            undoing.imported_count === 1
              ? "O lançamento criado"
              : `Os ${undoing.imported_count} lançamentos criados`
          } por ${undoing.original_filename} ${undoing.imported_count === 1 ? "sai" : "saem"}${
            undoingAccount ? ` de ${undoingAccount}` : " da conta"
          } de uma vez. Para tê-los de volta, envie o arquivo de novo.`}
          confirmLabel="Desfazer importação"
          loading={undo.isPending}
          onConfirm={() => confirmUndo(undoing)}
          onCancel={() => setUndoOpen(false)}
        />
      )}
    </PageContent>
  );
}
