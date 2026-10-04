import { FileUp, LoaderCircle, Wallet } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { Select } from "../../../components/ui/Select";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { errorMessage, fieldErrors, isApiError } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { importPath, importReviewPath, paths } from "../../../lib/paths";
import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import type { Account } from "../../accounts/types";
import { getLastUsedAccountId } from "../../transactions/services/transactionsService";
import { useImport } from "../hooks/useImport";
import { useUploadImport } from "../hooks/useUploadImport";
import {
  FILE_EMPTY_MESSAGE,
  FILE_REQUIRED_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  MAX_FILE_BYTES,
} from "../schemas";
import { isExpired, isWorking, type Import } from "../types";
import { BackToImports } from "./BackToImports";
import { MappingStep } from "./MappingStep";

interface UploadFormProps {
  /** As contas que podem receber lançamentos. */
  accounts: readonly Account[];
}

interface ImportProgressProps {
  importId: string;
}

interface WorkingCardProps {
  record: Import;
  accountName: string | undefined;
}

const ACCEPTED_FILES = ".ofx,.qfx,.csv,.txt,.xlsx";
// Erros do servidor que falam do arquivo: aparecem junto dele, e não no topo.
const FILE_ERROR_CODES = ["payload_too_large", "unsupported_file"];

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Escolha do arquivo e da conta de destino (FR-036). O envio leva à tela de andamento. */
function UploadForm({ accounts }: UploadFormProps) {
  const fileId = useId();
  const navigate = useNavigate();
  const upload = useUploadImport();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(() => {
    const lastUsed = getLastUsedAccountId();
    return (accounts.find((account) => account.id === lastUsed) ?? accounts[0])?.id ?? "";
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const chooseFile = (chosen: File | null): void => {
    setFile(chosen);
    setFormError(null);
    if (chosen && chosen.size > MAX_FILE_BYTES) setFileError(FILE_TOO_LARGE_MESSAGE);
    else if (chosen?.size === 0) setFileError(FILE_EMPTY_MESSAGE);
    else setFileError(null);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);
    if (!file) {
      setFileError(FILE_REQUIRED_MESSAGE);
      return;
    }
    if (fileError) return;
    upload.mutate(
      { file, accountId },
      {
        onSuccess: (record) => void navigate(importPath(record.id), { replace: true }),
        onError: (error) => {
          const fields = fieldErrors(error);
          if (fields.account_id) setAccountError(fields.account_id);
          else if (isApiError(error) && FILE_ERROR_CODES.includes(error.code)) {
            setFileError(error.message);
          } else setFormError(errorMessage(error));
        },
      },
    );
  };

  const fileErrorId = `${fileId}-error`;
  const fileHelpId = `${fileId}-help`;

  return (
    <Card>
      <form noValidate onSubmit={submit} className="grid gap-5">
        {formError && <Notice kind="error">{formError}</Notice>}

        <div className="grid gap-1.5">
          <label htmlFor={fileId} className="text-label text-ink">
            Arquivo do extrato
          </label>
          {/* O campo de arquivo cobre a área toda: clicar, tocar ou soltar um arquivo ali
              funciona como no campo nativo, que continua sendo o que o teclado alcança. */}
          <div
            className={cn(
              "relative flex min-h-28 flex-col items-center justify-center gap-1 rounded-md",
              "border-dashed bg-surface p-4 text-center transition-colors duration-fast ease-out",
              "hover:bg-bg-sunken has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
              "has-focus-visible:outline-primary",
              fileError ? "border-2 border-danger" : "border-[1.5px] border-border-strong",
            )}
          >
            <input
              id={fileId}
              type="file"
              accept={ACCEPTED_FILES}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={cn(fileError && fileErrorId, fileHelpId)}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <FileUp aria-hidden="true" className="size-6 text-primary" />
            <span aria-hidden="true" className="text-body font-bold text-primary">
              {file ? "Trocar arquivo" : "Escolher arquivo"}
            </span>
            {file && (
              <span aria-hidden="true" className="max-w-full text-small wrap-anywhere text-ink">
                {file.name} · {fileSizeLabel(file.size)}
              </span>
            )}
          </div>
          {fileError && (
            <p id={fileErrorId} role="alert" className="text-small text-danger">
              {fileError}
            </p>
          )}
          <p id={fileHelpId} className="text-small text-ink-muted">
            OFX, CSV ou planilha Excel (.xlsx), de até 10 MB. Baixe o extrato no site ou no
            aplicativo do seu banco.
          </p>
        </div>

        <Select
          label="Conta de destino"
          help="Os lançamentos do arquivo entram nesta conta, depois da sua revisão."
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          value={accountId}
          error={accountError ?? undefined}
          onChange={(event) => {
            setAccountId(event.target.value);
            setAccountError(null);
          }}
        />

        <Button
          type="submit"
          block
          loading={upload.isPending}
          className="sm:w-auto sm:justify-self-start"
        >
          Enviar arquivo
        </Button>
      </form>
    </Card>
  );
}

/** O arquivo está na fila ou sendo lido: a tela consulta de novo a cada 2 segundos. */
function WorkingCard({ record, accountName }: WorkingCardProps) {
  return (
    <Card>
      <div role="status" className="grid justify-items-center gap-3 py-6 text-center">
        <LoaderCircle aria-hidden="true" className="size-8 animate-spin text-primary" />
        <h2 className="font-display text-title-2 text-ink">
          {record.status === "queued" ? "Arquivo recebido" : "Lendo o arquivo…"}
        </h2>
        <p className="max-w-full text-body wrap-anywhere text-ink-muted">
          {record.original_filename}
          {accountName && ` · ${accountName}`}
        </p>
        <p className="max-w-96 text-small text-ink-muted">
          Costuma levar poucos segundos. Você pode sair desta tela: a leitura continua, e a
          importação fica esperando você em Importações.
        </p>
      </div>
    </Card>
  );
}

/** Andamento de uma importação: lendo, pedindo as colunas, pronta para revisar ou com erro. */
function ImportProgress({ importId }: ImportProgressProps) {
  const navigate = useNavigate();
  const record = useImport(importId);
  const accounts = useAccounts();

  if (record.isPending) {
    return (
      <Card flush>
        <SkeletonList rows={3} label="Carregando a importação…" />
      </Card>
    );
  }
  if (record.isError) {
    const notFound = isApiError(record.error) && record.error.status === 404;
    return notFound ? (
      <EmptyState
        kind="no-results"
        title="Importação não encontrada"
        description="Ela pode ter sido descartada. Veja o histórico ou envie o arquivo de novo."
        actionLabel="Ver importações"
        onAction={() => void navigate(paths.imports)}
      />
    ) : (
      <EmptyState
        kind="error"
        title="Não foi possível carregar a importação"
        description={errorMessage(record.error)}
        onAction={() => void record.refetch()}
      />
    );
  }

  const current = record.data;
  if (current.status === "awaiting_review") {
    return <Navigate to={importReviewPath(current.id)} replace />;
  }
  if (current.status === "completed" || current.status === "undone") {
    return <Navigate to={paths.imports} replace />;
  }
  if (isWorking(current.status)) {
    const account = accounts.data?.find((candidate) => candidate.id === current.account_id);
    return <WorkingCard record={current} accountName={account?.name} />;
  }
  if (current.status === "awaiting_mapping" && current.mapping_preview) {
    return <MappingStep key={current.id} record={current} preview={current.mapping_preview} />;
  }

  return (
    <Card>
      <div className="grid justify-items-start gap-4">
        <h2 className="text-title-3 text-ink">
          {isExpired(current) ? "O prazo desta importação terminou" : "Não deu para importar"}
        </h2>
        <Notice kind="error" className="w-full">
          {current.error_message ??
            "Algo deu errado ao ler o arquivo. Nada foi salvo. Envie o arquivo de novo."}
        </Notice>
        <p className="max-w-full text-small wrap-anywhere text-ink-muted">
          Arquivo: {current.original_filename}
        </p>
        <Button onClick={() => void navigate(paths.importNew)}>Enviar outro arquivo</Button>
      </div>
    </Card>
  );
}

/**
 * Envio de um extrato (OFX, CSV ou planilha) e o andamento dele. Sem importação no endereço, é
 * o formulário de envio; com ela, a tela acompanha a leitura até a revisão.
 */
export function UploadPage() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const accounts = useAccounts();

  let body: ReactNode;
  if (importId) {
    body = <ImportProgress importId={importId} />;
  } else if (accounts.isPending) {
    body = (
      <Card flush>
        <SkeletonList rows={3} label="Carregando suas contas…" />
      </Card>
    );
  } else if (accounts.isError) {
    body = (
      <EmptyState
        kind="error"
        title="Não foi possível carregar suas contas"
        description={errorMessage(accounts.error)}
        onAction={() => void accounts.refetch()}
      />
    );
  } else if (activeAccounts(accounts.data).length === 0) {
    body = (
      <EmptyState
        kind="first-time"
        icon={Wallet}
        title="Cadastre uma conta primeiro"
        description="Os lançamentos de um extrato entram em uma conta: a do banco ou um cartão."
        actionLabel="Cadastrar conta"
        onAction={() => void navigate(paths.accounts)}
      />
    );
  } else {
    body = <UploadForm accounts={activeAccounts(accounts.data)} />;
  }

  return (
    <PageContent>
      <BackToImports />
      <PageHeader title="Importar extrato" />
      {body}
    </PageContent>
  );
}
