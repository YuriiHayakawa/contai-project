import { Plus, Wallet } from "lucide-react";
import { useId, useState } from "react";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { formatBRL } from "../../../lib/money";
import { useNewTransaction } from "../../transactions/hooks/useNewTransaction";
import { invoicePaymentPreset } from "../../transactions/presets";
import { ACCOUNT_TYPE_ICONS } from "../account-type-icons";
import {
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
  useDeleteAccount,
  useUnarchiveAccount,
  useUpdateAccount,
} from "../hooks/useAccounts";
import { ACCOUNT_TYPE_LABELS, type Account, type AccountInput } from "../types";
import { AccountForm } from "./AccountForm";

interface AccountRowsProps {
  accounts: Account[];
  onSelect: (account: Account) => void;
}

interface AccountEditorProps {
  open: boolean;
  /** Conta em edição; sem ela, a folha cadastra uma conta nova. */
  account?: Account;
  onClose: () => void;
}

function AccountRows({ accounts, onSelect }: AccountRowsProps) {
  return (
    <ul>
      {accounts.map((account) => {
        const Icon = ACCOUNT_TYPE_ICONS[account.type];
        return (
          <li key={account.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => onSelect(account)}
              className={cn(
                "flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left sm:px-5",
                "transition-colors duration-fast ease-out hover:bg-bg-sunken",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  account.archived ? "bg-bg-sunken text-ink-muted" : "bg-primary-soft text-primary",
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-body font-bold text-ink">{account.name}</span>
                <span className="truncate text-small text-ink-muted">
                  {ACCOUNT_TYPE_LABELS[account.type]}
                  {account.institution && ` · ${account.institution}`}
                </span>
              </span>
              <span className="money text-money-md text-ink">
                {formatBRL(account.balance_cents)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Folha de cadastro e edição de uma conta, com as ações de arquivar e excluir. */
function AccountEditor({ open, account, onClose }: AccountEditorProps) {
  const formId = useId();
  const toast = useToast();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const archive = useArchiveAccount();
  const unarchive = useUnarchiveAccount();
  const remove = useDeleteAccount();
  const openNewTransaction = useNewTransaction();
  const [dirty, setDirty] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const saving = create.isPending || update.isPending;

  const close = (): void => {
    setDirty(false);
    setConfirmingDelete(false);
    onClose();
  };

  const save = async (input: AccountInput): Promise<void> => {
    if (account) {
      await update.mutateAsync({ id: account.id, input });
      toast.success("Conta atualizada.");
    } else {
      await create.mutateAsync(input);
      toast.success("Conta cadastrada.");
    }
    close();
  };

  const toggleArchived = (target: Account): void => {
    const action = target.archived ? unarchive : archive;
    action.mutate(target.id, {
      onSuccess: () => {
        toast.success(target.archived ? "Conta desarquivada." : "Conta arquivada.");
        close();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const confirmDelete = (target: Account): void => {
    remove.mutate(target.id, {
      onSuccess: () => {
        toast.success("Conta excluída.");
        close();
      },
      // Conta com lançamentos não é excluída: a mensagem do servidor orienta a arquivar.
      onError: (error) => {
        setConfirmingDelete(false);
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={account ? "Editar conta" : "Nova conta"}
        size="form"
        preventDismiss={dirty || saving}
        footer={
          <>
            <Button type="submit" form={formId} loading={saving}>
              {account ? "Salvar conta" : "Cadastrar conta"}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={close}>
              Cancelar
            </Button>
          </>
        }
      >
        <AccountForm
          key={account?.id ?? "new"}
          id={formId}
          account={account}
          onSubmit={save}
          onDirtyChange={setDirty}
        />
        {account && (
          <div className="mt-4 flex flex-wrap gap-x-2 border-t border-border pt-2">
            {account.type === "credit_card" && !account.archived && (
              <Button
                variant="ghost"
                className="-ml-5"
                onClick={() => {
                  close();
                  openNewTransaction(invoicePaymentPreset(account));
                }}
              >
                Pagar fatura
              </Button>
            )}
            <Button
              variant="ghost"
              className={account.type === "credit_card" && !account.archived ? undefined : "-ml-5"}
              loading={archive.isPending || unarchive.isPending}
              onClick={() => toggleArchived(account)}
            >
              {account.archived ? "Desarquivar conta" : "Arquivar conta"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Excluir conta
            </Button>
          </div>
        )}
      </Modal>

      {account && (
        <ConfirmDialog
          open={open && confirmingDelete}
          title={`Excluir a conta ${account.name}?`}
          description="A conta sai da sua lista de vez. Só dá para excluir uma conta sem lançamentos."
          confirmLabel="Excluir conta"
          loading={remove.isPending}
          onConfirm={() => confirmDelete(account)}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}

/** Contas do usuário, com o saldo de cada uma; as arquivadas ficam em um grupo à parte. */
export function AccountsPage() {
  const accounts = useAccounts();
  const [editorOpen, setEditorOpen] = useState(false);
  // Fica guardada depois de fechar, para a folha não trocar de conteúdo enquanto sai da tela.
  const [editing, setEditing] = useState<Account | undefined>(undefined);

  const openEditor = (account?: Account): void => {
    setEditing(account);
    setEditorOpen(true);
  };

  const active = accounts.data?.filter((account) => !account.archived) ?? [];
  const archived = accounts.data?.filter((account) => account.archived) ?? [];

  return (
    <PageContent>
      <PageHeader
        title="Contas"
        action={
          accounts.data &&
          accounts.data.length > 0 && (
            <Button icon={<Plus />} onClick={() => openEditor()}>
              Nova conta
            </Button>
          )
        }
      />

      {accounts.isPending && (
        <Card flush>
          <SkeletonList label="Carregando suas contas…" />
        </Card>
      )}

      {accounts.isError && (
        <EmptyState
          kind="error"
          title="Não foi possível carregar suas contas"
          description={errorMessage(accounts.error)}
          onAction={() => void accounts.refetch()}
        />
      )}

      {accounts.data?.length === 0 && (
        <EmptyState
          kind="first-time"
          icon={Wallet}
          title="Cadastre sua primeira conta"
          description="Pode ser a conta do banco, um cartão de crédito ou o dinheiro da carteira. É nela que os lançamentos entram."
          actionLabel="Cadastrar conta"
          onAction={() => openEditor()}
        />
      )}

      {accounts.data && accounts.data.length > 0 && (
        <div className="grid gap-6">
          {active.length > 0 ? (
            <Card flush>
              <AccountRows accounts={active} onSelect={openEditor} />
            </Card>
          ) : (
            <Card>
              <p className="text-body text-ink-muted">
                Todas as suas contas estão arquivadas. Cadastre uma conta nova ou desarquive uma
                delas para lançar.
              </p>
            </Card>
          )}
          {archived.length > 0 && (
            <Card flush title="Arquivadas">
              <AccountRows accounts={archived} onSelect={openEditor} />
            </Card>
          )}
        </div>
      )}

      <AccountEditor open={editorOpen} account={editing} onClose={() => setEditorOpen(false)} />
    </PageContent>
  );
}
