// Telas de lançamento novo e de edição: carregam contas, categorias e os últimos lançamentos, e
// mostram os estados de carregamento, erro e "sem contas".
import { paths } from "@web/lib/paths";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Screen } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api-client";
import { openSite } from "@/lib/site";

import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import { useCategories } from "../../categories/hooks/useCategories";
import { useRecentTransactions } from "../hooks/useMostUsedAccount";
import { useSaveTransaction } from "../hooks/useSaveTransaction";
import { useTransaction } from "../hooks/useTransaction";
import { EditTransaction } from "./EditTransaction";
import { TransactionForm } from "./TransactionForm";

function useFormData() {
  const accounts = useAccounts();
  const categories = useCategories();
  const recent = useRecentTransactions();
  const queries = [accounts, categories, recent];
  return {
    accounts: accounts.data,
    categories: categories.data,
    // As sugestões são um extra: sem os últimos lançamentos, o formulário abre mesmo assim.
    recent: recent.data ?? [],
    pending: accounts.isPending || categories.isPending || recent.isPending,
    error: accounts.error ?? categories.error,
    retry: () => queries.forEach((query) => void query.refetch()),
  };
}

function Frame({ children }: { children: ReactNode }) {
  return <Screen edges={["left", "right", "bottom"]}>{children}</Screen>;
}

export function NewTransactionScreen() {
  const router = useRouter();
  const toast = useToast();
  const data = useFormData();
  const save = useSaveTransaction();

  if (data.pending) {
    return (
      <Frame>
        <LoadingState message="Preparando o formulário…" />
      </Frame>
    );
  }
  if (data.error || !data.accounts || !data.categories) {
    return (
      <Frame>
        <ErrorState message={errorMessage(data.error)} onRetry={data.retry} />
      </Frame>
    );
  }
  if (activeAccounts(data.accounts).length === 0) {
    return (
      <Frame>
        <EmptyState
          title="Cadastre uma conta primeiro"
          description="Todo lançamento fica numa conta, como a corrente ou o cartão. As contas são cadastradas pelo site."
          actionLabel="Cadastrar conta no site"
          onAction={() => void openSite(paths.accounts)}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <TransactionForm
        accounts={data.accounts}
        categories={data.categories}
        recent={data.recent}
        submitLabel="Salvar lançamento"
        saving={save.isPending}
        saveError={save.error}
        onSubmit={(input) =>
          save.mutate(
            { input },
            {
              onSuccess: () => {
                toast.show({ message: "Lançamento salvo.", kind: "success" });
                router.back();
              },
            },
          )
        }
      />
    </Frame>
  );
}

export function EditTransactionScreen({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const data = useFormData();
  const transaction = useTransaction(id);

  if (data.pending || transaction.isPending) {
    return (
      <Frame>
        <LoadingState message="Abrindo o lançamento…" />
      </Frame>
    );
  }
  const error = transaction.error ?? data.error;
  if (error || !transaction.data || !data.accounts || !data.categories) {
    return (
      <Frame>
        <ErrorState
          title="Não foi possível abrir o lançamento"
          message={errorMessage(error)}
          onRetry={() => {
            data.retry();
            void transaction.refetch();
          }}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <EditTransaction
        transaction={transaction.data}
        accounts={data.accounts}
        categories={data.categories}
        recent={data.recent}
        onDone={(result) => {
          toast.show({
            message: result === "saved" ? "Lançamento atualizado." : "Lançamento excluído.",
            kind: "success",
          });
          router.back();
        }}
      />
    </Frame>
  );
}
