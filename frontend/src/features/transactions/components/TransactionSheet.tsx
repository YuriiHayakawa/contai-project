import { LoaderCircle, Wallet } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import { useCategories } from "../../categories/hooks/useCategories";
import { useCreateTransaction } from "../hooks/useCreateTransaction";
import { useUpdateTransaction } from "../hooks/useUpdateTransaction";
import type { Transaction, TransactionInput } from "../types";
import { TransactionForm } from "./TransactionForm";

export interface TransactionSheetProps {
  open: boolean;
  /** Lançamento em edição; sem ele, a folha cria um lançamento novo. */
  transaction?: Transaction;
  onClose: () => void;
}

/**
 * Folha do formulário de lançamento. Fica montada mesmo fechada: assim as contas e as
 * categorias já estão carregadas quando o usuário toca em "Lançar".
 */
export function TransactionSheet({ open, transaction, onClose }: TransactionSheetProps) {
  const formId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const categories = useCategories();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const [dirty, setDirty] = useState(false);
  // Cada abertura começa com o formulário em branco, mesmo reaberta antes de terminar de sair.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening(opening + 1);
  }

  const saving = create.isPending || update.isPending;

  const close = (): void => {
    setDirty(false);
    onClose();
  };

  const save = async (input: TransactionInput): Promise<void> => {
    if (transaction) {
      await update.mutateAsync({ id: transaction.id, input });
      toast.success("Lançamento atualizado.");
    } else {
      await create.mutateAsync(input);
      toast.success("Lançamento salvo.");
    }
    close();
  };

  let body: ReactNode;
  let hasForm = false;
  if (!accounts.data || !categories.data) {
    const loadError = accounts.error ?? categories.error;
    body = loadError ? (
      <EmptyState
        kind="error"
        title="Não foi possível abrir o formulário"
        description={errorMessage(loadError)}
        onAction={() => {
          void accounts.refetch();
          void categories.refetch();
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
        amountRef={amountRef}
        onSubmit={save}
        onDirtyChange={setDirty}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={transaction ? "Editar lançamento" : "Novo lançamento"}
      size="form"
      // Um lançamento novo abre com o foco no valor; na edição, o teclado não sobe sozinho.
      initialFocusRef={transaction ? undefined : amountRef}
      preventDismiss={dirty || saving}
      footer={
        hasForm && (
          <>
            <Button type="submit" form={formId} loading={saving}>
              Salvar lançamento
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
  );
}
