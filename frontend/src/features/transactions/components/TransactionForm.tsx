import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState, type RefObject } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { MoneyInput } from "../../../components/ui/MoneyInput";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select, type SelectOption } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { today } from "../../../lib/dates";
import type { Account } from "../../accounts/types";
import { categoryOptions } from "../../categories/hooks/useCategories";
import type { CategoryTree } from "../../categories/types";
import { transactionSchema, type TransactionFormValues } from "../schemas";
import { getLastUsedAccountId } from "../services/transactionsService";
import type { EntryType, Transaction, TransactionInput } from "../types";

export interface TransactionFormProps {
  /** Id do `<form>`: o botão de salvar fica no rodapé da folha e aponta para ele. */
  id: string;
  /** Todas as contas do usuário; só as ativas viram opção de um lançamento novo. */
  accounts: readonly Account[];
  categories: CategoryTree;
  /** Lançamento em edição; sem ele, o formulário cria um lançamento novo. */
  transaction?: Transaction;
  /** Recebe o campo de valor, para a folha abrir com o foco nele. */
  amountRef?: RefObject<HTMLInputElement | null>;
  /** Salva o lançamento. Se rejeitar, a mensagem do servidor aparece no campo ou no topo. */
  onSubmit: (input: TransactionInput) => Promise<unknown>;
  /** Avisa quando há dados digitados e não salvos, para a folha não fechar sem querer. */
  onDirtyChange?: (dirty: boolean) => void;
}

// Campo da API → campo do formulário, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, keyof TransactionFormValues> = {
  type: "type",
  amount_cents: "amountCents",
  date: "date",
  description: "description",
  account_id: "accountId",
  category_id: "categoryId",
  notes: "notes",
};

const typeOptions = [
  { value: "expense", label: "Despesa" },
  { value: "income", label: "Receita" },
] as const;

const ARCHIVED_SUFFIX = " (arquivada)";

function entryTypeOf(transaction: Transaction): EntryType {
  return transaction.type === "income" ? "income" : "expense";
}

/**
 * Um lançamento novo já vem com a data de hoje e a última conta usada (FR-028); se ela não
 * serve mais, vem a primeira conta ativa.
 */
function initialValues(
  transaction: Transaction | undefined,
  accounts: readonly Account[],
): TransactionFormValues {
  if (transaction) {
    return {
      type: entryTypeOf(transaction),
      amountCents: transaction.amount_cents,
      description: transaction.description,
      categoryId: transaction.category_id ?? "",
      accountId: transaction.account_id,
      date: transaction.date,
      notes: transaction.notes ?? "",
    };
  }
  const usable = accounts.filter((account) => !account.archived);
  const lastUsedId = getLastUsedAccountId();
  const account = usable.find((candidate) => candidate.id === lastUsedId) ?? usable[0];
  return {
    type: "expense",
    amountCents: 0,
    description: "",
    categoryId: "",
    accountId: account?.id ?? "",
    date: today(),
    notes: "",
  };
}

/**
 * Formulário de lançamento: Despesa ou Receita, valor, descrição, categoria, conta, data e
 * observação. O valor é o centro dele.
 */
export function TransactionForm({
  id,
  accounts,
  categories,
  transaction,
  amountRef,
  onSubmit,
  onDirtyChange,
}: TransactionFormProps) {
  const amountId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register: field,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isDirty },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: initialValues(transaction, accounts),
  });
  const type = useWatch({ control, name: "type" });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // A conta e a categoria de um lançamento antigo continuam nas opções mesmo arquivadas: ele
  // segue editável sem ter de trocá-las (FR-026).
  const accountOptions: SelectOption[] = accounts
    .filter((account) => !account.archived || account.id === transaction?.account_id)
    .map((account) => ({
      value: account.id,
      label: account.archived ? `${account.name}${ARCHIVED_SUFFIX}` : account.name,
    }));
  const categorySelectOptions: SelectOption[] = categoryOptions(categories, type, {
    includeArchived: true,
  })
    .filter(({ category }) => !category.archived || category.id === transaction?.category_id)
    .map(({ category, label }) => ({
      value: category.id,
      label: category.archived ? `${label}${ARCHIVED_SUFFIX}` : label,
    }));

  const changeType = (next: EntryType): void => {
    setValue("type", next, { shouldDirty: true });
    // As categorias são de um tipo só: a escolhida não vale para o outro.
    const stillValid = categoryOptions(categories, next, { includeArchived: true }).some(
      ({ category }) => category.id === getValues("categoryId"),
    );
    if (!stillValid) setValue("categoryId", "");
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({
        type: values.type,
        amount_cents: values.amountCents,
        date: values.date,
        description: values.description,
        account_id: values.accountId,
        category_id: values.categoryId,
        notes: values.notes || null,
      });
    } catch (error) {
      let shown = false;
      for (const [apiField, message] of Object.entries(fieldErrors(error))) {
        const formField = API_FIELDS[apiField];
        if (!formField) continue;
        setError(formField, { message }, { shouldFocus: true });
        shown = true;
      }
      if (!shown) setFormError(errorMessage(error));
    }
  });

  return (
    <form id={id} noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {formError && <Notice kind="error">{formError}</Notice>}

      <SegmentedControl
        label="Tipo de lançamento"
        hideLabel
        options={typeOptions}
        value={type}
        onChange={changeType}
      />

      <div className="grid gap-1.5">
        <label htmlFor={amountId} className="text-label text-ink">
          Valor
        </label>
        <Controller
          control={control}
          name="amountCents"
          render={({ field: amount }) => (
            <MoneyInput
              id={amountId}
              ref={(input) => {
                amount.ref(input);
                if (amountRef) amountRef.current = input;
              }}
              tone={type === "income" ? "income" : "ink"}
              value={amount.value}
              onChange={amount.onChange}
              onBlur={amount.onBlur}
              error={errors.amountCents?.message}
            />
          )}
        />
      </div>

      <TextField
        label="Descrição"
        autoComplete="off"
        enterKeyHint="next"
        error={errors.description?.message}
        {...field("description")}
      />
      <Select
        label="Categoria"
        placeholder="Escolha uma categoria"
        options={categorySelectOptions}
        error={errors.categoryId?.message}
        {...field("categoryId")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Conta"
          options={accountOptions}
          error={errors.accountId?.message}
          {...field("accountId")}
        />
        <TextField label="Data" type="date" error={errors.date?.message} {...field("date")} />
      </div>
      <TextField
        label="Observação"
        optional
        autoComplete="off"
        placeholder="Algo para lembrar depois"
        error={errors.notes?.message}
        {...field("notes")}
      />
    </form>
  );
}
