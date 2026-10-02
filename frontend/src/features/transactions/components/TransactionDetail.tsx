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
import type { Transaction, TransactionType } from "../types";
import { signedAmount } from "./TransactionList";

export interface TransactionDetailProps {
  open: boolean;
  /** Fica guardado depois de fechar, para a folha não esvaziar enquanto sai da tela. */
  transaction?: Transaction;
  account?: Account;
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

/** Detalhe de um lançamento, com as ações de editar e de excluir (com confirmação). */
export function TransactionDetail({
  open,
  transaction,
  account,
  category,
  onClose,
  onEdit,
}: TransactionDetailProps) {
  const toast = useToast();
  const remove = useDeleteTransaction();
  const [confirming, setConfirming] = useState(false);

  if (!transaction) return null;

  const { label: typeLabel, icon: TypeIcon } = typeAppearance[transaction.type];
  // Transferência tem tela própria de edição, nos dois lados de uma vez.
  const isEntry = transaction.type !== "transfer";

  const close = (): void => {
    setConfirming(false);
    onClose();
  };

  const confirmDelete = (): void => {
    remove.mutate(transaction.id, {
      onSuccess: () => {
        toast.success("Lançamento excluído.");
        close();
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Lançamento"
        footer={
          isEntry && (
            <>
              <Button icon={<Pencil />} onClick={() => onEdit(transaction)}>
                Editar lançamento
              </Button>
              <Button variant="secondary" icon={<Trash2 />} onClick={() => setConfirming(true)}>
                Excluir lançamento
              </Button>
            </>
          )
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
          <DetailRow label="Conta">
            <span className="min-w-0 wrap-break-word">
              {account?.name ?? "Conta não encontrada"}
              {account?.archived && ARCHIVED_SUFFIX}
            </span>
          </DetailRow>
          <DetailRow label="Data">{dayLabel(transaction.date)}</DetailRow>
          {transaction.installment_number && transaction.installment_count && (
            <DetailRow label="Parcela">
              {transaction.installment_number} de {transaction.installment_count}
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

      <ConfirmDialog
        open={open && confirming}
        title="Excluir este lançamento?"
        description="Ele sai da lista e o saldo da conta volta a ser o de antes dele. Não dá para desfazer."
        confirmLabel="Excluir lançamento"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
