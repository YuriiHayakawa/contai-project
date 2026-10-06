import { FileUp, LoaderCircle, Wallet } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select } from "../../../components/ui/Select";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { errorMessage, fieldErrors, isApiError } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { importPath, importReviewPath, paths } from "../../../lib/paths";
import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import type { Account } from "../../accounts/types";
import { getLastUsedAccountId } from "../../transactions/services/transactionsService";
import { useAiConsent } from "../hooks/useAiConsent";
import { useImport } from "../hooks/useImport";
import { useUploadImport } from "../hooks/useUploadImport";
import {
  FILE_EMPTY_MESSAGE,
  FILE_REQUIRED_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  MAX_FILE_BYTES,
  RECEIPT_EMPTY_MESSAGE,
  RECEIPT_REQUIRED_MESSAGE,
  RECEIPT_TOO_LARGE_MESSAGE,
  needsAiReading,
} from "../schemas";
import {
  AI_CONSENT_REQUIRED,
  isExpired,
  isReadByAi,
  isWaitingForAi,
  isWorking,
  type Import,
  type ImportKind,
} from "../types";
import { AiConsentDialog } from "./AiConsentDialog";
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

interface KindCopy {
  fileLabel: string;
  /** Os tipos que o seletor de arquivos oferece; quem confere de verdade é o servidor. */
  accept: string;
  help: string;
  accountHelp: string;
  required: string;
  tooLarge: string;
  empty: string;
}

const KIND_OPTIONS: readonly { value: ImportKind; label: string }[] = [
  { value: "statement", label: "Extrato ou fatura" },
  { value: "receipt", label: "Comprovante" },
];

const KIND_COPY: Record<ImportKind, KindCopy> = {
  statement: {
    fileLabel: "Arquivo do extrato ou da fatura",
    accept: ".ofx,.qfx,.csv,.txt,.xlsx,.pdf",
    help:
      "OFX, CSV, planilha Excel (.xlsx) ou PDF, de até 10 MB. Baixe o extrato ou a fatura no " +
      "site ou no aplicativo do seu banco. O PDF é lido por um serviço de IA externo; os outros " +
      "formatos, sem IA.",
    accountHelp: "Os lançamentos do arquivo entram nesta conta, depois da sua revisão.",
    required: FILE_REQUIRED_MESSAGE,
    tooLarge: FILE_TOO_LARGE_MESSAGE,
    empty: FILE_EMPTY_MESSAGE,
  },
  receipt: {
    fileLabel: "Foto ou PDF do comprovante",
    accept: ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf",
    help:
      "Foto (JPG ou PNG) ou PDF de um comprovante, recibo ou nota fiscal, de até 10 MB. Vira " +
      "um lançamento só, lido por um serviço de IA externo.",
    accountHelp: "O lançamento do comprovante entra nesta conta, depois da sua revisão.",
    required: RECEIPT_REQUIRED_MESSAGE,
    tooLarge: RECEIPT_TOO_LARGE_MESSAGE,
    empty: RECEIPT_EMPTY_MESSAGE,
  },
};

// Erros do servidor que falam do arquivo: aparecem junto dele, e não no topo.
const FILE_ERROR_CODES = ["payload_too_large", "unsupported_file"];

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Escolha do que enviar, do arquivo e da conta de destino (FR-036). Antes do primeiro PDF ou
 * imagem, o aviso sobre o serviço de IA externo pede o aceite (FR-044). O envio leva à tela de
 * andamento.
 */
function UploadForm({ accounts }: UploadFormProps) {
  const fileId = useId();
  const navigate = useNavigate();
  const upload = useUploadImport();
  const consent = useAiConsent();
  const [kind, setKind] = useState<ImportKind>("statement");
  const [askingConsent, setAskingConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(() => {
    const lastUsed = getLastUsedAccountId();
    return (accounts.find((account) => account.id === lastUsed) ?? accounts[0])?.id ?? "";
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const copy = KIND_COPY[kind];

  const chooseKind = (chosen: ImportKind): void => {
    // O arquivo de um extrato não serve de comprovante, e vice-versa: a escolha recomeça.
    setKind(chosen);
    setFile(null);
    setFileError(null);
    setFormError(null);
  };

  const chooseFile = (chosen: File | null): void => {
    setFile(chosen);
    setFormError(null);
    if (chosen && chosen.size > MAX_FILE_BYTES) setFileError(copy.tooLarge);
    else if (chosen?.size === 0) setFileError(copy.empty);
    else setFileError(null);
  };

  const send = (chosen: File): void => {
    upload.mutate(
      { file: chosen, accountId, kind },
      {
        onSuccess: (record) => void navigate(importPath(record.id), { replace: true }),
        onError: (error) => {
          const fields = fieldErrors(error);
          if (fields.account_id) setAccountError(fields.account_id);
          // O arquivo não serve para o que foi escolhido, como uma foto enviada como extrato.
          else if (fields.kind) setFileError(fields.kind);
          // O servidor é quem sabe do aceite: se ele falta, o aviso aparece agora.
          else if (isApiError(error) && error.code === AI_CONSENT_REQUIRED) setAskingConsent(true);
          else if (isApiError(error) && FILE_ERROR_CODES.includes(error.code)) {
            setFileError(error.message);
          } else setFormError(errorMessage(error));
        },
      },
    );
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);
    if (!file) {
      setFileError(copy.required);
      return;
    }
    if (fileError) return;
    // PDF e imagem vão a um serviço de IA externo: nada é enviado antes do aceite.
    if (needsAiReading(file) && !consent.accepted) {
      setAskingConsent(true);
      return;
    }
    send(file);
  };

  const acceptAndSend = (): void => {
    consent.accept.mutate(undefined, {
      onSuccess: () => {
        setAskingConsent(false);
        if (file) send(file);
      },
    });
  };

  const cancelConsent = (): void => {
    consent.accept.reset();
    setAskingConsent(false);
  };

  const fileErrorId = `${fileId}-error`;
  const fileHelpId = `${fileId}-help`;

  return (
    <Card>
      <form noValidate onSubmit={submit} className="grid gap-5">
        {formError && <Notice kind="error">{formError}</Notice>}

        <SegmentedControl
          label="O que você vai enviar"
          options={KIND_OPTIONS}
          value={kind}
          onChange={chooseKind}
        />

        <div className="grid gap-1.5">
          <label htmlFor={fileId} className="text-label text-ink">
            {copy.fileLabel}
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
              // Trocar o que vai ser enviado esvazia o campo: o arquivo anterior não vale mais.
              key={kind}
              id={fileId}
              type="file"
              accept={copy.accept}
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
            {copy.help}
          </p>
        </div>

        <Select
          label="Conta de destino"
          help={copy.accountHelp}
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

      <AiConsentDialog
        open={askingConsent}
        loading={consent.accept.isPending}
        error={consent.accept.isError ? errorMessage(consent.accept.error) : null}
        onAccept={acceptAndSend}
        onCancel={cancelConsent}
      />
    </Card>
  );
}

/**
 * O arquivo está na fila ou sendo lido: a tela consulta de novo a cada 2 segundos. Quando o
 * serviço de IA está ocupado, a leitura é tentada de novo sozinha, e a tela diz isso (FR-072).
 */
function WorkingCard({ record, accountName }: WorkingCardProps) {
  const waitingForAi = isWaitingForAi(record);
  let title = record.status === "queued" ? "Arquivo recebido" : "Lendo o arquivo…";
  if (waitingForAi) title = "Aguardando o serviço de IA";

  return (
    <Card>
      <div role="status" className="grid justify-items-center gap-3 py-6 text-center">
        <LoaderCircle aria-hidden="true" className="size-8 animate-spin text-primary" />
        <h2 className="font-display text-title-2 text-ink">{title}</h2>
        <p className="max-w-full text-body wrap-anywhere text-ink-muted">
          {record.original_filename}
          {accountName && ` · ${accountName}`}
        </p>
        {waitingForAi && record.error_message && (
          <p className="max-w-96 text-body text-ink">{record.error_message}</p>
        )}
        <p className="max-w-96 text-small text-ink-muted">
          {isReadByAi(record.format)
            ? "A leitura por IA pode levar cerca de um minuto."
            : "Costuma levar poucos segundos."}{" "}
          Você pode sair desta tela: a leitura continua, e a importação fica esperando você em
          Importações.
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
 * Envio de um extrato ou de uma fatura (OFX, CSV, planilha ou PDF) ou de um comprovante (foto
 * ou PDF), e o andamento dele. Sem importação no endereço, é o formulário de envio; com ela, a
 * tela acompanha a leitura até a revisão.
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
      <PageHeader title="Importar arquivo" />
      {body}
    </PageContent>
  );
}
