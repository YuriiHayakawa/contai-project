import { ArrowDown, ArrowLeftRight, ArrowUp, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../../components/ui/Button";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dayLabel } from "../../../lib/dates";
import type { Account } from "../../accounts/types";
import type { CategoryOption } from "../../categories/hooks/useCategories";
import { useDeleteTransaction } from "../hooks/useDeleteTransaction";
import { useRelatedTransactions } from "../hooks/useTransactions";
import type { EditScope, Transaction, TransactionType } from "../types";
import { ScopeDialog } from "./ScopeDialog";
import { signedAmount } from "./TransactionList";

export interface TransactionDetailProps {
  open: boolean;
  /** Fica guardado depois de fechar, para a folha não esvaziar enquanto sai da tela. */
  transaction?: Transaction;
  /** Todas as contas por id, inclusive as arquivadas. */
  accounts: ReadonlyMap<string, Account>;
  category?: CategoryOption;
  onClose: () => void;
  /** Abre o formulário de edição do lançamento. */
  onEdit: (transaction: Transaction) => void;
}

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

const typeAppearance: Record<TransactionType, { label: string; icon: LucideIcon }> = {
  expense: { label: "Despesa", icon: ArrowDown },
  income: { label: "Receita", icon: ArrowUp },
  transfer: { label: "Transferência", icon: ArrowLeftRight },
};

const ARCHIVED_SUFFIX = " (arquivada)";

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="grid gap-0.5 border-b border-border py-3 last:border-b-0">
      <dt className="text-small text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-body text-ink">{children}</dd>
    </div>
  );
}

function accountName(account: Account | undefined): string {
  if (!account) return "Conta não encontrada";
  return account.archived ? `${account.name}${ARCHIVED_SUFFIX}` : account.name;
}

/**
 * Detalhe de um lançamento, com as ações de editar e de excluir. Uma parcela pergunta se a
 * exclusão vale só para ela ou também para as próximas; uma transferência sai dos dois lados.
 */
export function TransactionDetail({
  open,
  transaction,
  accounts,
  category,
  onClose,
  onEdit,
}: TransactionDetailProps) {
  const toast = useToast();
  const remove = useDeleteTransaction();
  const related = useRelatedTransactions(transaction);
  const [confirming, setConfirming] = useState(false);
  const [pendingScope, setPendingScope] = useState<EditScope | null>(null);

  if (!transaction) return null;

  const { label, icon: TypeIcon } = typeAppearance[transaction.type];
  // Receita em categoria de despesa: abate o gasto dela, e não conta como entrada do mês.
  const isRefund = transaction.type === "income" && category?.category.kind === "expense";
  const typeLabel = isRefund ? "Estorno" : label;
  const isTransfer = transaction.type === "transfer";
  const number = transaction.installment_number;
  const count = transaction.installment_count;
  const following =
    number === null
      ? 0
      : (related.data?.filter((line) => (line.installment_number ?? 0) >= number).length ??
        (count ?? number) - number + 1);
  const asksScope = number !== null && count !== null && following > 1;
  const out = related.data?.find((line) => line.transfer_direction === "out");
  const received = related.data?.find((line) => line.transfer_direction === "in");

  const close = (): void => {
    setConfirming(false);
    onClose();
  };

  const confirmDelete = (scope: EditScope = "single"): void => {
    setPendingScope(scope);
    remove.mutate(
      { id: transaction.id, scope },
      {
        onSuccess: () => {
          if (isTransfer) toast.success("Transferência excluída das duas contas.");
          else if (scope === "following") toast.success(`${following} parcelas excluídas.`);
          else toast.success("Lançamento excluído.");
          close();
        },
        onError: (error) => {
          setConfirming(false);
          toast.error(errorMessage(error));
        },
        onSettled: () => setPendingScope(null),
      },
    );
  };

  const transferAccounts =
    out && received
      ? `${accountName(accounts.get(out.account_id))} e ${accountName(accounts.get(received.account_id))}`
      : "as duas contas";

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={isTransfer ? "Transferência" : "Lançamento"}
        footer={
          <>
            <Button icon={<Pencil />} onClick={() => onEdit(transaction)}>
              {isTransfer ? "Editar transferência" : "Editar lançamento"}
            </Button>
            <Button variant="secondary" icon={<Trash2 />} onClick={() => setConfirming(true)}>
              {isTransfer ? "Excluir transferência" : "Excluir lançamento"}
            </Button>
          </>
        }
      >
        <p className="flex items-center gap-1.5 text-label text-ink-muted">
          <TypeIcon aria-hidden="true" className="size-4" />
          {typeLabel}
        </p>
        <p
          className={cn(
            "money text-money-lg",
            transaction.type === "income" ? "text-income" : "text-ink",
          )}
        >
          {signedAmount(transaction)}
        </p>
        <p className="mt-1 wrap-break-word text-body font-bold text-ink">
          {transaction.description}
        </p>
        {isTransfer && (
          <p className="mt-1 text-small text-ink-muted">
            Não conta como gasto nem como receita: só move dinheiro entre as suas contas.
          </p>
        )}

        <dl className="mt-3 border-t border-border">
          {category && (
            <DetailRow label="Categoria">
              <CategoryChip
                color={category.category.color}
                icon={category.category.icon}
                size="sm"
              />
              <span className="min-w-0 wrap-break-word">
                {category.label}
                {category.category.archived && ARCHIVED_SUFFIX}
              </span>
            </DetailRow>
          )}
          {isTransfer ? (
            <>
              <DetailRow label="Sai de">
                <span className="min-w-0 wrap-break-word">
                  {out ? accountName(accounts.get(out.account_id)) : "…"}
                </span>
              </DetailRow>
              <DetailRow label="Entra em">
                <span className="min-w-0 wrap-break-word">
                  {received ? accountName(accounts.get(received.account_id)) : "…"}
                </span>
              </DetailRow>
            </>
          ) : (
            <DetailRow label="Conta">
              <span className="min-w-0 wrap-break-word">
                {accountName(accounts.get(transaction.account_id))}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Data">{dayLabel(transaction.date)}</DetailRow>
          {number !== null && count !== null && (
            <DetailRow label="Parcela">
              {number} de {count}
            </DetailRow>
          )}
          {transaction.notes && (
            <DetailRow label="Observação">
              <span className="min-w-0 wrap-break-word whitespace-pre-line">
                {transaction.notes}
              </span>
            </DetailRow>
          )}
        </dl>
      </Modal>

      {asksScope ? (
        <ScopeDialog
          open={open && confirming}
          action="delete"
          number={number}
          count={count}
          following={following}
          pending={pendingScope}
          onChoose={confirmDelete}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <ConfirmDialog
          open={open && confirming}
          title={isTransfer ? "Excluir esta transferência?" : "Excluir este lançamento?"}
          description={
            isTransfer
              ? `Ela sai das duas contas, ${transferAccounts}, e os dois saldos voltam a ser os de antes. Não dá para desfazer.`
              : "Ele sai da lista e o saldo da conta volta a ser o de antes dele. Não dá para desfazer."
          }
          confirmLabel={isTransfer ? "Excluir transferência" : "Excluir lançamento"}
          loading={remove.isPending}
          onConfirm={() => confirmDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
