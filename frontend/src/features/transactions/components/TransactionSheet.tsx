import { LoaderCircle, Wallet } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { monthName, yearMonthOf, type ISODate } from "../../../lib/dates";
import { paths } from "../../../lib/paths";
import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import { useCategories } from "../../categories/hooks/useCategories";
import { isDateShown, monthSearch, readListView } from "../filters";
import { useCreateInstallments } from "../hooks/useCreateInstallments";
import { useCreateTransaction } from "../hooks/useCreateTransaction";
import { useCreateTransfer } from "../hooks/useCreateTransfer";
import { useRelatedTransactions } from "../hooks/useTransactions";
import { useUpdateTransaction } from "../hooks/useUpdateTransaction";
import type { EditScope, Transaction, TransactionPatch, TransactionPreset } from "../types";
import { ScopeDialog } from "./ScopeDialog";
import {
  TransactionForm,
  type TransactionSubmission,
  type TransferAccounts,
} from "./TransactionForm";

export interface TransactionSheetProps {
  open: boolean;
  /** Lançamento em edição; sem ele, a folha cria um lançamento novo. */
  transaction?: Transaction;
  /** O que já vem preenchido em um lançamento novo, como no "Pagar fatura" de um cartão. */
  preset?: TransactionPreset;
  onClose: () => void;
}

type ScopeAnswer = (scope: EditScope | null) => void;

/** Só os campos que mudaram: uma parcela editada com as seguintes não leva junto o resto. */
function changedFields(
  transaction: Transaction,
  submission: TransactionSubmission,
): TransactionPatch {
  const input = submission.input;
  const patch: TransactionPatch = {};
  if ("type" in input && input.type !== transaction.type) patch.type = input.type;
  if ("amount_cents" in input && input.amount_cents !== transaction.amount_cents) {
    patch.amount_cents = input.amount_cents;
  }
  if (input.date !== transaction.date) patch.date = input.date;
  if (input.description !== transaction.description) patch.description = input.description;
  if ("account_id" in input && input.account_id !== transaction.account_id) {
    patch.account_id = input.account_id;
  }
  if ("category_id" in input && input.category_id !== transaction.category_id) {
    patch.category_id = input.category_id;
  }
  if (input.notes !== transaction.notes) patch.notes = input.notes;
  return patch;
}

function transferAccountsOf(lines: readonly Transaction[]): TransferAccounts | undefined {
  const out = lines.find((line) => line.transfer_direction === "out");
  const received = lines.find((line) => line.transfer_direction === "in");
  if (!out || !received) return undefined;
  return { fromAccountId: out.account_id, toAccountId: received.account_id };
}

/**
 * Folha do formulário de lançamento. Fica montada mesmo fechada: assim as contas e as
 * categorias já estão carregadas quando o usuário toca em "Lançar".
 */
export function TransactionSheet({ open, transaction, preset, onClose }: TransactionSheetProps) {
  const formId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const accounts = useAccounts();
  const categories = useCategories();
  const related = useRelatedTransactions(transaction);
  const create = useCreateTransaction();
  const createInstallments = useCreateInstallments();
  const createTransfer = useCreateTransfer();
  const update = useUpdateTransaction();
  const [dirty, setDirty] = useState(false);
  const [scopeAnswer, setScopeAnswer] = useState<ScopeAnswer | null>(null);
  const [pendingScope, setPendingScope] = useState<EditScope | null>(null);
  // Cada abertura começa com o formulário em branco, mesmo reaberta antes de terminar de sair.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening(opening + 1);
  }

  const saving =
    create.isPending ||
    createInstallments.isPending ||
    createTransfer.isPending ||
    update.isPending;
  const isTransfer = transaction?.type === "transfer";
  const number = transaction?.installment_number ?? null;
  const count = transaction?.installment_count ?? null;
  // Quantas parcelas sobram desta em diante: alguma pode já ter sido excluída.
  const following =
    number === null
      ? 0
      : (related.data?.filter((line) => (line.installment_number ?? 0) >= number).length ??
        (count ?? number) - number + 1);

  const close = (): void => {
    setDirty(false);
    onClose();
  };

  /**
   * Avisa que o lançamento foi salvo. Com a data fora do período exibido, ele não aparece na
   * lista que o usuário está vendo: o aviso diz em que mês ficou e leva até lá.
   */
  const announce = (date: ISODate, saved: string, savedElsewhere: string): void => {
    // Na tela de lançamentos, vale o período escolhido nela; nas outras, o mês atual.
    const search = location.pathname === paths.transactions ? location.search : "";
    if (isDateShown(date, readListView(new URLSearchParams(search)).filters)) {
      toast.success(saved);
      return;
    }
    const month = yearMonthOf(date);
    const sameYear = month.slice(0, 4) === yearMonthOf().slice(0, 4);
    const name = sameYear ? monthName(month) : `${monthName(month)} de ${month.slice(0, 4)}`;
    toast.success(`${savedElsewhere} ${name}.`, {
      action: {
        label: `Ver ${monthName(month)}`,
        onClick: () => void navigate(`${paths.transactions}${monthSearch(month)}`),
      },
    });
  };

  /** Pergunta, em uma parcela, se a mudança vale só para ela ou também para as próximas. */
  const askScope = (): Promise<EditScope | null> =>
    new Promise((resolve) => {
      setScopeAnswer(() => resolve);
    });

  const answerScope = (scope: EditScope | null): void => {
    scopeAnswer?.(scope);
    if (scope === null) setScopeAnswer(null);
    setPendingScope(scope);
  };

  const saveEdit = async (current: Transaction, submission: TransactionSubmission) => {
    const patch = changedFields(current, submission);
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    let scope: EditScope = "single";
    if (current.installment_group_id && following > 1) {
      const chosen = await askScope();
      if (chosen === null) return;
      scope = chosen;
    }
    try {
      const updated = await update.mutateAsync({ id: current.id, input: patch, scope });
      const first = updated[0];
      if (updated.length > 1) toast.success(`${updated.length} parcelas atualizadas.`);
      else if (first && isTransfer) {
        announce(
          first.date,
          "Transferência atualizada.",
          "Transferência atualizada. Agora ela está em",
        );
      } else if (first) {
        announce(first.date, "Lançamento atualizado.", "Lançamento atualizado. Agora ele está em");
      }
      close();
    } finally {
      setScopeAnswer(null);
      setPendingScope(null);
    }
  };

  const save = async (submission: TransactionSubmission): Promise<void> => {
    if (transaction) {
      await saveEdit(transaction, submission);
      return;
    }
    if (submission.kind === "installments") {
      const parcels = await createInstallments.mutateAsync(submission.input);
      const what = `Compra em ${parcels.length}x salva.`;
      announce(parcels[0]?.date ?? submission.input.date, what, `${what} A 1ª parcela está em`);
    } else if (submission.kind === "transfer") {
      await createTransfer.mutateAsync(submission.input);
      announce(submission.input.date, "Transferência salva.", "Transferência salva em");
    } else {
      const created = await create.mutateAsync(submission.input);
      announce(created.date, "Lançamento salvo.", "Lançamento salvo em");
    }
    close();
  };

  let body: ReactNode;
  let hasForm = false;
  const waitingRelated = isTransfer && related.data === undefined;
  if (!accounts.data || !categories.data || waitingRelated) {
    const loadError = accounts.error ?? categories.error ?? related.error;
    body = loadError ? (
      <EmptyState
        kind="error"
        title="Não foi possível abrir o formulário"
        description={errorMessage(loadError)}
        onAction={() => {
          void accounts.refetch();
          void categories.refetch();
          void related.refetch();
        }}
      />
    ) : (
      <div role="status" className="flex justify-center py-8">
        <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-ink-muted" />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  } else if (!transaction && activeAccounts(accounts.data).length === 0) {
    body = (
      <EmptyState
        kind="first-time"
        icon={Wallet}
        title="Cadastre uma conta primeiro"
        description="Todo lançamento entra em uma conta: a do banco, um cartão ou o dinheiro da carteira."
        actionLabel="Cadastrar conta"
        onAction={() => {
          close();
          void navigate(paths.accounts);
        }}
      />
    );
  } else {
    hasForm = true;
    body = (
      <TransactionForm
        key={`${transaction?.id ?? "new"}-${opening}`}
        id={formId}
        accounts={accounts.data}
        categories={categories.data}
        transaction={transaction}
        transferAccounts={isTransfer ? transferAccountsOf(related.data ?? []) : undefined}
        preset={transaction ? undefined : preset}
        amountRef={amountRef}
        onSubmit={save}
        onDirtyChange={setDirty}
      />
    );
  }

  let title = "Novo lançamento";
  if (isTransfer) title = "Editar transferência";
  else if (number !== null && count !== null) title = `Editar parcela ${number} de ${count}`;
  else if (transaction) title = "Editar lançamento";
  else if (preset?.type === "transfer") title = "Nova transferência";

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={title}
        size="form"
        // Um lançamento novo abre com o foco no valor; na edição, o teclado não sobe sozinho.
        initialFocusRef={transaction ? undefined : amountRef}
        preventDismiss={dirty || saving}
        footer={
          hasForm && (
            <>
              <Button type="submit" form={formId} loading={saving}>
                {isTransfer || preset?.type === "transfer"
                  ? "Salvar transferência"
                  : "Salvar lançamento"}
              </Button>
              <Button variant="secondary" disabled={saving} onClick={close}>
                Cancelar
              </Button>
            </>
          )
        }
      >
        {body}
      </Modal>

      {number !== null && count !== null && (
        <ScopeDialog
          open={open && scopeAnswer !== null}
          action="edit"
          number={number}
          count={count}
          following={following}
          pending={pendingScope}
          onChoose={answerScope}
          onCancel={() => answerScope(null)}
        />
      )}
    </>
  );
}
