import { CircleAlert, Clock, Copy, CopyCheck, CreditCard, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Notice } from "../../../components/ui/Notice";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import {
  errorMessage,
  fieldErrors,
  isApiError,
  isSessionExpiredError,
} from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dateTimeLabel, dayLabel, shortDate, type ISODate } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { importPath, paths } from "../../../lib/paths";
import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import type { Account } from "../../accounts/types";
import {
  categoriesById,
  useCategories,
  type CategoryOption,
} from "../../categories/hooks/useCategories";
import type { CategoryTree } from "../../categories/types";
import { ALL_PERIOD_PARAM, FILTER_PARAM } from "../../transactions/filters";
import { useConfirmImport } from "../hooks/useConfirmImport";
import { useDiscardImport } from "../hooks/useDiscardImport";
import { useImport } from "../hooks/useImport";
import {
  leavesAccount,
  reviewBalanceCents,
  useImportReview,
  type ReviewLine,
} from "../hooks/useImportReview";
import type { ReviewLineValues } from "../schemas";
import {
  INVOICE_PAYMENT_WITHOUT_CARD,
  type BalanceCheck,
  type Import,
  type ImportItem,
} from "../types";
import { BackToImports } from "./BackToImports";
import { ReviewLineSheet } from "./ReviewLineSheet";
import { Seal } from "./Seal";

interface ReviewBodyProps {
  record: Import;
  items: readonly ImportItem[];
  accounts: readonly Account[];
  categories: CategoryTree;
}

interface ReviewRowProps {
  line: ReviewLine;
  /** O que falta corrigir na linha para ela poder ser importada. */
  problem: string | undefined;
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, CategoryOption>;
  onToggle: () => void;
  onEdit: () => void;
}

interface BalanceNoticeProps {
  check: BalanceCheck;
  lines: readonly ReviewLine[];
}

interface DayGroup {
  date: ISODate;
  lines: ReviewLine[];
}

const rowDomId = (itemId: string): string => `linha-${itemId}`;

const lineCount = (count: number): string => (count === 1 ? "1 linha" : `${count} linhas`);
const entryCount = (count: number): string =>
  count === 1 ? "1 lançamento" : `${count} lançamentos`;

/** As linhas da mais nova para a mais antiga, por dia, como na lista de lançamentos. */
function groupByDay(lines: readonly ReviewLine[]): DayGroup[] {
  const sorted = [...lines].sort(
    (a, b) => b.date.localeCompare(a.date) || a.item.row_index - b.item.row_index,
  );
  const groups: DayGroup[] = [];
  for (const line of sorted) {
    const last = groups.at(-1);
    if (last?.date === line.date) last.lines.push(line);
    else groups.push({ date: line.date, lines: [line] });
  }
  return groups;
}

/** Despesa com `−`, receita e estorno com `+`, transferência com o sinal desta conta. */
function signedAmount(line: ReviewLine): string {
  const cents = leavesAccount(line.item) ? -line.amountCents : line.amountCents;
  return formatBRL(cents, { sign: "always" });
}

/** O que a linha vira ao ser importada: a categoria, o estorno ou a outra conta. */
function lineDetails(
  line: ReviewLine,
  accounts: ReadonlyMap<string, Account>,
  categories: ReadonlyMap<string, CategoryOption>,
): string {
  if (line.kind === "transfer") {
    const other = accounts.get(line.counterAccountId)?.name;
    if (!other) return "Transferência: falta a outra conta";
    return leavesAccount(line.item) ? `Transferência para ${other}` : `Transferência de ${other}`;
  }
  const category = categories.get(line.categoryId)?.label ?? "Sem categoria";
  return line.kind === "refund" ? `Estorno · ${category}` : category;
}

/**
 * Linha do modo de revisão (seção 6.6 do design-system.md): a caixa de seleção fica na margem
 * e o resto da linha abre a correção.
 */
function ReviewRow({ line, problem, accounts, categories, onToggle, onEdit }: ReviewRowProps) {
  const { item, selected, kind } = line;
  const isIncome = kind === "income" || kind === "refund";

  return (
    <li
      id={rowDomId(item.id)}
      className="grid scroll-mt-16 grid-cols-[3.5rem_minmax(0,1fr)] border-b border-border last:border-b-0"
    >
      <label className="ml-1 flex size-11 items-center justify-center self-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Importar ${line.description}, ${signedAmount(line)}`}
          className="size-6 accent-primary"
        />
      </label>
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-3",
          "py-2.5 pr-3 pl-3 text-left transition-colors duration-fast ease-out hover:bg-bg-sunken",
        )}
      >
        <span
          className={cn(
            "line-clamp-2 min-w-0 wrap-break-word text-body font-bold",
            selected ? "text-ink" : "text-ink-muted",
          )}
        >
          <span className="sr-only">Corrigir: </span>
          {line.description}
        </span>
        <span
          className={cn(
            "money text-money-md sm:row-span-2",
            !selected || kind === "transfer"
              ? "text-ink-muted"
              : isIncome
                ? "text-income"
                : "text-ink",
          )}
        >
          {signedAmount(line)}
        </span>
        {/* Em tela estreita, o que a linha vira e os selos usam a largura toda, sob o valor. */}
        <span className="col-span-2 min-w-0 truncate text-small text-ink-muted sm:col-span-1">
          {selected ? lineDetails(line, accounts, categories) : "Não será importada"}
        </span>
        <span className="col-span-2 mt-1 flex flex-wrap gap-1 empty:hidden">
          {item.duplicate_status === "probable" && (
            <Seal tone="warning" icon={Copy}>
              Possível duplicata
            </Seal>
          )}
          {item.duplicate_status === "exact" && (
            <Seal tone="warning" icon={CopyCheck}>
              Já importada
            </Seal>
          )}
          {item.warning_code === INVOICE_PAYMENT_WITHOUT_CARD && kind === "expense" && (
            <Seal tone="warning" icon={TriangleAlert}>
              Parece pagamento de fatura
            </Seal>
          )}
          {kind === "transfer" && item.suggested_counter_account_id && (
            <Seal tone="info" icon={CreditCard}>
              Pagamento de fatura
            </Seal>
          )}
          {problem && (
            <Seal tone="danger" icon={CircleAlert}>
              {problem}
            </Seal>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * O saldo do banco contra o da conta com as linhas marcadas agora (FR-082). A divergência
 * avisa, com os dois valores, e não impede a importação.
 */
function BalanceNotice({ check, lines }: BalanceNoticeProps) {
  const computed = reviewBalanceCents(check, lines);
  const day = shortDate(check.bank_balance_date);
  const money = (cents: number): ReactNode => (
    <span className="money font-bold">{formatBRL(cents)}</span>
  );

  // A data vem antes dos valores: abreviada, ela termina em ponto ("30 de set.").
  if (computed === check.bank_balance_cents) {
    return (
      <Notice kind="success">
        O saldo confere com o do banco: em {day}, com as linhas marcadas, a conta fica com{" "}
        {money(computed)}.
      </Notice>
    );
  }
  return (
    <Notice kind="warning">
      O saldo não bate com o do banco. Em {day}, o banco informa {money(check.bank_balance_cents)};
      com as linhas marcadas, a conta fica com {money(computed)}: diferença de{" "}
      {money(Math.abs(check.bank_balance_cents - computed))}. Você pode importar assim mesmo e
      conferir depois o que falta ou sobra.
    </Notice>
  );
}

/** A revisão em si: só é montada com a importação, as contas e as categorias carregadas. */
function ReviewBody({ record, items, accounts, categories }: ReviewBodyProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const review = useImportReview(record, categories, {
    // A linha já voltou ao que estava salvo; o aviso diz o que fazer.
    onSaveError: (error) => {
      if (isSessionExpiredError(error)) return;
      const reason = Object.values(fieldErrors(error))[0] ?? errorMessage(error);
      toast.error(`A alteração não foi salva. ${reason}`);
    },
  });
  const confirm = useConfirmImport();
  const discard = useDiscardImport();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Linhas recusadas pelo servidor na confirmação, com o que fazer em cada uma.
  const [rejected, setRejected] = useState<ReadonlyMap<string, string>>(new Map());
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const { lines, selectedCount, allSelected, problems } = review;
  const accountsMap = new Map(accounts.map((account) => [account.id, account]));
  const categoriesMap = categoriesById(categories);
  const account = accountsMap.get(record.account_id);
  const counterAccounts = activeAccounts(accounts).filter(
    (candidate) => candidate.id !== record.account_id,
  );
  const editing = lines.find((line) => line.item.id === editingId);
  const duplicates = items.filter((item) => item.duplicate_status !== "none").length;
  const invoiceWarning = lines.find(
    // Só enquanto a linha vai entrar como despesa: desmarcada ou como transferência, não há
    // gasto contado duas vezes.
    (line) =>
      line.selected &&
      line.item.warning_code === INVOICE_PAYMENT_WITHOUT_CARD &&
      line.kind === "expense",
  )?.item.warning_message;

  // "Marcar todas" fica no meio-termo quando só parte das linhas está marcada.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected]);

  const problemOf = (line: ReviewLine): string | undefined => {
    if (!line.selected) return undefined;
    const local = problems.get(line.item.id);
    return (local ? Object.values(local)[0] : undefined) ?? rejected.get(line.item.id);
  };

  const saveLine = (values: ReviewLineValues): void => {
    if (!editing) return;
    review.edit(editing.item.id, values);
    setRejected((current) => {
      const next = new Map(current);
      next.delete(editing.item.id);
      return next;
    });
    setConfirmError(null);
    setSheetOpen(false);
  };

  const showProblems = (ids: readonly string[], message: string): void => {
    setConfirmError(message);
    const first = ids[0];
    if (first) document.getElementById(rowDomId(first))?.scrollIntoView({ block: "center" });
  };

  const submit = (): void => {
    setConfirmError(null);
    if (problems.size > 0) {
      showProblems(
        [...problems.keys()],
        `Corrija ${lineCount(problems.size)} antes de importar: toque em cada linha destacada para ver o que falta.`,
      );
      return;
    }
    confirm.mutate(
      { id: record.id, items: review.confirmItems() },
      {
        onSuccess: (saved) => {
          toast.success(
            `${entryCount(saved.imported_count)} ${saved.imported_count === 1 ? "importado" : "importados"}${account ? ` em ${account.name}` : ""}.`,
            {
              action: {
                label: "Ver lançamentos",
                onClick: () =>
                  void navigate(
                    `${paths.transactions}?${FILTER_PARAM.period}=${ALL_PERIOD_PARAM}&${FILTER_PARAM.account}=${record.account_id}`,
                  ),
              },
            },
          );
          void navigate(paths.imports);
        },
        onError: (error) => {
          // O servidor aponta as linhas pela posição no corpo enviado: `items.3.category_id`.
          const refused = new Map<string, string>();
          let general: string | undefined;
          for (const [field, message] of Object.entries(fieldErrors(error))) {
            const position = /^items\.(\d+)\./.exec(field)?.[1];
            const line = position === undefined ? undefined : lines[Number(position)];
            if (line) refused.set(line.item.id, message);
            else general ??= message;
          }
          setRejected(refused);
          if (refused.size > 0) {
            showProblems(
              [...refused.keys()],
              `Corrija ${lineCount(refused.size)} antes de importar: toque em cada linha destacada para ver o que falta.`,
            );
          } else setConfirmError(general ?? errorMessage(error));
        },
      },
    );
  };

  const confirmDiscard = (): void => {
    discard.mutate(record.id, {
      onSuccess: () => {
        toast.success("Importação descartada. Nada foi salvo.");
        void navigate(paths.imports);
      },
      onError: (error) => {
        setConfirmingDiscard(false);
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <>
      <div className="grid gap-3">
        <p className="text-body wrap-anywhere text-ink-muted">
          {lineCount(items.length)} de {record.original_filename}
          {account && `, para ${account.name}`}. Confira, corrija o que precisar e desmarque o que
          não quer importar. Cada alteração fica guardada, e nada vira lançamento antes da
          confirmação.
          {duplicates > 0 &&
            ` ${duplicates === 1 ? "1 linha vem desmarcada porque parece" : `${duplicates} linhas vêm desmarcadas porque parecem`} já estar na conta.`}
        </p>

        {record.already_imported_at && (
          <Notice kind="info">
            Este arquivo já foi importado nesta conta em {dateTimeLabel(record.already_imported_at)}
            . As linhas que já estão na conta vêm desmarcadas, para nada entrar duas vezes.
          </Notice>
        )}
        {record.total_check?.matches && (
          <Notice kind="success">
            A soma das linhas lidas confere com o total do documento:{" "}
            <span className="money font-bold">
              {formatBRL(record.total_check.document_total_cents)}
            </span>
            .
          </Notice>
        )}
        {record.total_check && !record.total_check.matches && (
          <Notice kind="warning">
            A soma das linhas não bate com o total do documento. O documento informa{" "}
            <span className="money font-bold">
              {formatBRL(record.total_check.document_total_cents)}
            </span>
            ; as linhas lidas somam{" "}
            <span className="money font-bold">
              {formatBRL(record.total_check.extracted_total_cents)}
            </span>
            . Confira se falta ou sobra alguma linha.
          </Notice>
        )}
        {record.balance_check && <BalanceNotice check={record.balance_check} lines={lines} />}
        {invoiceWarning && <Notice kind="warning">{invoiceWarning}</Notice>}
      </div>

      <section
        aria-label="Linhas do arquivo"
        className={cn(
          "relative mt-4 overflow-clip rounded-lg border border-border bg-surface",
          // Linha de margem: as caixas de seleção ficam à esquerda dela e o texto à direita.
          "before:absolute before:inset-y-0 before:left-13.5 before:w-0.5 before:bg-margin-line",
        )}
      >
        <div className="relative flex min-h-12 items-center justify-between gap-3 border-b border-border bg-surface pr-3">
          <label className="flex min-h-11 items-center text-label text-ink">
            <span className="ml-1 flex size-11 items-center justify-center">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={() => review.toggleAll(!allSelected)}
                className="size-6 accent-primary"
              />
            </span>
            <span className="pl-5">Marcar todas</span>
          </label>
          <p role="status" className="text-small text-ink-muted">
            {selectedCount} de {items.length} marcadas
          </p>
        </div>

        {groupByDay(lines).map((group) => (
          <section key={group.date} aria-label={dayLabel(group.date)}>
            <header className="sticky top-0 z-10 border-b border-border bg-bg-sunken py-2.5 pr-3 pl-17">
              <h2 className="text-label text-ink-muted">{dayLabel(group.date)}</h2>
            </header>
            <ul>
              {group.lines.map((line) => (
                <ReviewRow
                  key={line.item.id}
                  line={line}
                  problem={problemOf(line)}
                  accounts={accountsMap}
                  categories={categoriesMap}
                  onToggle={() => review.toggle(line.item.id)}
                  onEdit={() => {
                    setEditingId(line.item.id);
                    setSheetOpen(true);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </section>

      {record.expires_at && (
        <p className="mt-3 flex items-start gap-2 text-small text-ink-muted">
          <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Você pode sair e continuar esta revisão depois: ela fica disponível por 7 dias, até{" "}
            {dateTimeLabel(record.expires_at)}. Depois disso nada é importado, e é preciso enviar o
            arquivo de novo.
          </span>
        </p>
      )}
      <Button variant="ghost" className="mt-1 -ml-5" onClick={() => setConfirmingDiscard(true)}>
        Descartar importação
      </Button>

      {/* A confirmação acompanha a rolagem: fica acima da barra inferior, sempre à mão. */}
      <div
        className={cn(
          "sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mt-4 grid gap-2 rounded-lg",
          "border border-border bg-surface-raised p-3 shadow-md lg:bottom-4",
          "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        )}
      >
        {confirmError && (
          <Notice kind="error" className="p-3 text-small sm:col-span-2">
            {confirmError}
          </Notice>
        )}
        <p className="text-small text-ink-muted">
          {review.isSaving && "Salvando as alterações… "}
          {selectedCount === 0
            ? "Marque ao menos uma linha para importar."
            : `${entryCount(selectedCount)} ${selectedCount === 1 ? "entra" : "entram"}${account ? ` em ${account.name}` : " na conta"}.`}
        </p>
        {/* A confirmação espera a última alteração ser salva: o servidor recebe uma por vez. */}
        <Button
          block
          disabled={selectedCount === 0}
          loading={confirm.isPending || review.isSaving}
          onClick={submit}
          className="sm:w-auto"
        >
          {selectedCount === 0 ? "Importar lançamentos" : `Importar ${entryCount(selectedCount)}`}
        </Button>
      </div>

      <ReviewLineSheet
        open={sheetOpen}
        line={editing}
        counterAccounts={counterAccounts}
        categories={categories}
        onSave={saveLine}
        onClose={() => setSheetOpen(false)}
      />
      <ConfirmDialog
        open={confirmingDiscard}
        title="Descartar esta importação?"
        description="As linhas lidas do arquivo e as correções feitas são apagadas, e nada é importado. Para importar depois, envie o arquivo de novo."
        confirmLabel="Descartar importação"
        loading={discard.isPending}
        onConfirm={confirmDiscard}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </>
  );
}

/**
 * Revisão de uma importação (FR-046), no modo de revisão da lista de lançamentos: marcar e
 * desmarcar linhas, corrigir valor, data, descrição e categoria, ver as duplicatas e os avisos
 * de total do documento, de saldo e de pagamento de fatura, e confirmar. Cada alteração é guardada no servidor, e a
 * revisão pode ser retomada depois de sair da página (FR-085); nada vira lançamento antes da
 * confirmação.
 */
export function ReviewPage() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const record = useImport(importId);
  const accounts = useAccounts();
  const categories = useCategories();

  let body: ReactNode;
  const loaded = record.data && accounts.data && categories.data;
  // Com a revisão na tela, uma conferência que falha em segundo plano não a tira dali.
  const loadError = loaded ? null : (record.error ?? accounts.error ?? categories.error);
  if (isApiError(record.error) && record.error.status === 404) {
    body = (
      <EmptyState
        kind="no-results"
        title="Importação não encontrada"
        description="Ela pode ter sido descartada. Veja o histórico ou envie o arquivo de novo."
        actionLabel="Ver importações"
        onAction={() => void navigate(paths.imports)}
      />
    );
  } else if (loadError) {
    body = (
      <EmptyState
        kind="error"
        title="Não foi possível carregar a revisão"
        description={errorMessage(loadError)}
        onAction={() => {
          void record.refetch();
          void accounts.refetch();
          void categories.refetch();
        }}
      />
    );
  } else if (!record.data || !accounts.data || !categories.data) {
    body = (
      <Card flush>
        <SkeletonList label="Carregando as linhas do arquivo…" />
      </Card>
    );
  } else if (record.data.status === "completed" || record.data.status === "undone") {
    // Já confirmada: o lugar dela é o histórico, onde dá para desfazer.
    return <Navigate to={paths.imports} replace />;
  } else if (record.data.status !== "awaiting_review" || !record.data.items) {
    // Ainda sendo lida, esperando as colunas ou com erro: a tela de andamento cuida disso.
    return <Navigate to={importPath(record.data.id)} replace />;
  } else {
    body = (
      <ReviewBody
        key={record.data.id}
        record={record.data}
        items={record.data.items}
        accounts={accounts.data}
        categories={categories.data}
      />
    );
  }

  return (
    <PageContent>
      <BackToImports />
      <PageHeader title="Revisar importação" />
      {body}
    </PageContent>
  );
}
