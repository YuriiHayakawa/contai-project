import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, Info } from "lucide-react";
import { useEffect, useId, useState, type RefObject } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "../../../components/ui/Button";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select, type SelectOption } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { addMonthsToDate, monthLabel, shortDate, today, yearMonthOf } from "../../../lib/dates";
import { formatBRL, splitInstallments } from "../../../lib/money";
import type { Account } from "../../accounts/types";
import { categoryOptions } from "../../categories/hooks/useCategories";
import type { CategoryTree } from "../../categories/types";
import { transactionSchema, type TransactionFormValues } from "../schemas";
import { getLastUsedAccountId } from "../services/transactionsService";
import type {
  InstallmentsInput,
  InvoicePaymentContext,
  Transaction,
  TransactionInput,
  TransactionPreset,
  TransactionType,
  TransferInput,
} from "../types";

/** O que o formulário entrega para ser salvo. */
export type TransactionSubmission =
  | { kind: "entry"; input: TransactionInput }
  | { kind: "installments"; input: InstallmentsInput }
  | { kind: "transfer"; input: TransferInput };

/** As duas contas de uma transferência em edição. */
export interface TransferAccounts {
  fromAccountId: string;
  toAccountId: string;
}

export interface TransactionFormProps {
  /** Id do `<form>`: o botão de salvar fica no rodapé da folha e aponta para ele. */
  id: string;
  /** Todas as contas do usuário; só as ativas viram opção de um lançamento novo. */
  accounts: readonly Account[];
  categories: CategoryTree;
  /** Lançamento em edição; sem ele, o formulário cria um lançamento novo. */
  transaction?: Transaction;
  /** Na edição de uma transferência: de onde saiu e para onde foi o dinheiro. */
  transferAccounts?: TransferAccounts;
  /** O que já vem preenchido em um lançamento novo, como no "Pagar fatura" de um cartão. */
  preset?: TransactionPreset;
  /** Recebe o campo de valor, para a folha abrir com o foco nele. */
  amountRef?: RefObject<HTMLInputElement | null>;
  /** Salva o lançamento. Se rejeitar, a mensagem do servidor aparece no campo ou no topo. */
  onSubmit: (submission: TransactionSubmission) => Promise<unknown>;
  /** Avisa quando há dados digitados e não salvos, para a folha não fechar sem querer. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface InvoicePaymentHintProps {
  payment: InvoicePaymentContext;
  amountCents: number;
  onChooseAmount: (amountCents: number) => void;
}

interface InstallmentPreviewProps {
  totalCents: number;
  count: number;
  /** Data da compra, que é a da primeira parcela. */
  date: string;
}

// Campo da API → campo do formulário, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, keyof TransactionFormValues> = {
  type: "type",
  amount_cents: "amountCents",
  total_cents: "amountCents",
  installments: "installments",
  date: "date",
  description: "description",
  account_id: "accountId",
  category_id: "categoryId",
  from_account_id: "fromAccountId",
  to_account_id: "toAccountId",
  notes: "notes",
};

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: "Despesa",
  income: "Receita",
  transfer: "Transferência",
};

const TRANSFER_DESCRIPTION = "Transferência";
const MAX_INSTALLMENTS = 48;
const ARCHIVED_SUFFIX = " (arquivada)";

const installmentOptions: SelectOption[] = [
  { value: "1", label: "À vista" },
  ...Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, index) => ({
    value: String(index + 2),
    label: `${index + 2}x`,
  })),
];

const isCard = (account: Account | undefined): boolean => account?.type === "credit_card";

/**
 * Valores iniciais. Um lançamento novo vem com a data de hoje e a última conta usada (FR-028);
 * se ela não serve mais, vem a primeira conta ativa. Uma transferência sai, por padrão, de uma
 * conta que não é cartão.
 */
function initialValues(
  accounts: readonly Account[],
  transaction: Transaction | undefined,
  transferAccounts: TransferAccounts | undefined,
  preset: TransactionPreset | undefined,
): TransactionFormValues {
  if (transaction) {
    return {
      type: transaction.type,
      amountCents: transaction.amount_cents,
      description: transaction.description,
      categoryId: transaction.category_id ?? "",
      accountId: transaction.account_id,
      installments: "1",
      fromAccountId: transferAccounts?.fromAccountId ?? "",
      toAccountId: transferAccounts?.toAccountId ?? "",
      date: transaction.date,
      notes: transaction.notes ?? "",
    };
  }
  const usable = accounts.filter((account) => !account.archived);
  const lastUsedId = getLastUsedAccountId();
  const account = usable.find((candidate) => candidate.id === lastUsedId) ?? usable[0];
  const notCard = usable.filter((candidate) => !isCard(candidate));
  const source =
    preset?.fromAccountId ??
    (account && !isCard(account) && account.id !== preset?.toAccountId
      ? account.id
      : notCard.find((candidate) => candidate.id !== preset?.toAccountId)?.id);
  const type = preset?.type ?? "expense";
  return {
    type,
    amountCents: preset?.amountCents ?? 0,
    description: preset?.description ?? (type === "transfer" ? TRANSFER_DESCRIPTION : ""),
    categoryId: "",
    accountId: account?.id ?? "",
    installments: "1",
    fromAccountId: source ?? "",
    toAccountId: preset?.toAccountId ?? "",
    date: today(),
    notes: "",
  };
}

const ordinal = (position: number): string => `${position}ª`;

/**
 * Prévia da compra parcelada: o valor e o mês de cada parcela, como serão gravados, com os
 * centavos que sobram da divisão na primeira.
 */
function InstallmentPreview({ totalCents, count, date }: InstallmentPreviewProps) {
  const amounts = splitInstallments(totalCents, count);
  const [first, rest] = [amounts[0], amounts[1]];
  if (first === undefined || rest === undefined) {
    return (
      <p className="rounded-md bg-bg-sunken p-3 text-small text-ink-muted">
        Informe o valor total para ver as parcelas.
      </p>
    );
  }
  const extra = first - rest;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div className="rounded-md bg-bg-sunken p-3">
      <p aria-live="polite" className="text-small text-ink">
        {count} parcelas de <span className="money font-bold">{formatBRL(rest)}</span>
        {extra > 0 && (
          <>
            , com <span className="money font-bold">{formatBRL(extra)}</span> a mais na 1ª
          </>
        )}
        . Total: <span className="money font-bold">{formatBRL(totalCents)}</span>.
      </p>
      <ol aria-label="Parcelas" className="mt-2 max-h-52 divide-y divide-border overflow-y-auto">
        {amounts.map((amount, index) => (
          <li key={index} className="flex items-baseline justify-between gap-3 py-1.5 text-small">
            <span className="text-ink-muted">
              {ordinal(index + 1)}
              {validDate && ` · ${monthLabel(yearMonthOf(addMonthsToDate(date, index)))}`}
            </span>
            <span className="money text-money-sm text-ink">{formatBRL(amount)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * No "Pagar fatura": de onde vem o valor sugerido. Com uma fatura fechada em aberto, um toque
 * troca o valor por tudo o que se deve no cartão, e outro volta para a fatura.
 */
function InvoicePaymentHint({ payment, amountCents, onChooseAmount }: InvoicePaymentHintProps) {
  const { closedInvoice: closed, totalDueCents: totalDue } = payment;
  if (!closed) {
    return (
      <p className="rounded-md bg-bg-sunken p-3 text-small text-ink-muted">
        {totalDue > 0
          ? "A fatura atual ainda não fechou. O valor é tudo o que você deve hoje neste cartão."
          : "Você não deve nada neste cartão hoje."}
      </p>
    );
  }
  const payingAll = amountCents === totalDue;
  return (
    <div className="grid justify-items-start gap-2 rounded-md bg-bg-sunken p-3">
      <p className="grid text-small">
        <span className="text-ink">
          Fatura fechada: falta pagar{" "}
          <span className="money font-bold">{formatBRL(closed.amountCents)}</span>
        </span>
        <span className="text-ink-muted">
          {closed.dueDate < today() ? "Venceu" : "Vence"} em {shortDate(closed.dueDate)}
        </span>
      </p>
      {totalDue > closed.amountCents && (
        <Button
          variant="secondary"
          onClick={() => onChooseAmount(payingAll ? closed.amountCents : totalDue)}
        >
          {payingAll
            ? `Pagar só a fatura fechada: ${formatBRL(closed.amountCents)}`
            : `Pagar tudo o que devo: ${formatBRL(totalDue)}`}
        </Button>
      )}
    </div>
  );
}

/**
 * Formulário de lançamento: despesa, receita ou transferência. Na despesa em cartão, também a
 * compra parcelada, com a prévia das parcelas. O valor é o centro dele.
 */
export function TransactionForm({
  id,
  accounts,
  categories,
  transaction,
  transferAccounts,
  preset,
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
    defaultValues: initialValues(accounts, transaction, transferAccounts, preset),
  });
  const [type, accountId, installments, amountCents, date, fromAccountId, toAccountId] = useWatch({
    control,
    name: [
      "type",
      "accountId",
      "installments",
      "amountCents",
      "date",
      "fromAccountId",
      "toAccountId",
    ],
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const editing = transaction !== undefined;
  const isTransfer = type === "transfer";
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const installmentCount = Number(installments);
  // A compra parcelada é só para despesa nova em cartão de crédito (FR-030).
  const canSplit = !editing && type === "expense" && isCard(byId.get(accountId));

  // Na edição, um lançamento não vira transferência nem deixa de ser uma.
  let typeOptions: TransactionType[] = ["expense", "income", "transfer"];
  if (editing) typeOptions = isTransfer ? ["transfer"] : ["expense", "income"];
  // Parcela é sempre despesa no cartão.
  if (transaction?.installment_group_id) typeOptions = ["expense"];

  // A conta e a categoria de um lançamento antigo continuam nas opções mesmo arquivadas: ele
  // segue editável sem ter de trocá-las (FR-026).
  const accountOptions = (keep: string[]): SelectOption[] =>
    accounts
      .filter((account) => !account.archived || keep.includes(account.id))
      .map((account) => ({
        value: account.id,
        label: account.archived ? `${account.name}${ARCHIVED_SUFFIX}` : account.name,
      }));
  const entryType = type === "income" ? "income" : "expense";
  const categorySelectOptions: SelectOption[] = categoryOptions(categories, entryType, {
    includeArchived: true,
  })
    .filter(({ category }) => !category.archived || category.id === transaction?.category_id)
    .map(({ category, label }) => ({
      value: category.id,
      label: category.archived ? `${label}${ARCHIVED_SUFFIX}` : label,
    }));

  const changeType = (next: TransactionType): void => {
    setValue("type", next, { shouldDirty: true });
    if (next === "transfer") {
      if (!getValues("description").trim()) setValue("description", TRANSFER_DESCRIPTION);
      return;
    }
    if (getValues("description") === TRANSFER_DESCRIPTION) setValue("description", "");
    if (next === "income") setValue("installments", "1");
    // As categorias são de um tipo só: a escolhida não vale para o outro.
    const stillValid = categoryOptions(categories, next, { includeArchived: true }).some(
      ({ category }) => category.id === getValues("categoryId"),
    );
    if (!stillValid) setValue("categoryId", "");
  };

  const accountField = field("accountId");

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const notes = values.notes || null;
    let submission: TransactionSubmission;
    if (values.type === "transfer") {
      submission = {
        kind: "transfer",
        input: {
          from_account_id: values.fromAccountId,
          to_account_id: values.toAccountId,
          amount_cents: values.amountCents,
          date: values.date,
          description: values.description,
          notes,
        },
      };
    } else if (canSplit && Number(values.installments) > 1) {
      submission = {
        kind: "installments",
        input: {
          total_cents: values.amountCents,
          installments: Number(values.installments),
          date: values.date,
          description: values.description,
          account_id: values.accountId,
          category_id: values.categoryId,
          notes,
        },
      };
    } else {
      submission = {
        kind: "entry",
        input: {
          type: values.type,
          amount_cents: values.amountCents,
          date: values.date,
          description: values.description,
          account_id: values.accountId,
          category_id: values.categoryId,
          notes,
        },
      };
    }
    try {
      await onSubmit(submission);
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

  const from = byId.get(fromAccountId);
  const to = byId.get(toAccountId);
  // O aviso do "Pagar fatura" vale enquanto o destino é o cartão que se foi pagar.
  const invoicePayment =
    !editing && preset?.toAccountId === toAccountId ? preset.invoicePayment : undefined;

  return (
    <form id={id} noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {formError && <Notice kind="error">{formError}</Notice>}

      {typeOptions.length > 1 && (
        <SegmentedControl
          label="Tipo de lançamento"
          hideLabel
          options={typeOptions.map((value) => ({ value, label: TYPE_LABELS[value] }))}
          value={type}
          onChange={changeType}
        />
      )}

      <div className="grid gap-1.5">
        <label htmlFor={amountId} className="text-label text-ink">
          {canSplit && installmentCount > 1 ? "Valor total da compra" : "Valor"}
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

      {isTransfer ? (
        <>
          {invoicePayment && (
            <InvoicePaymentHint
              payment={invoicePayment}
              amountCents={amountCents}
              onChooseAmount={(next) =>
                setValue("amountCents", next, { shouldDirty: true, shouldValidate: true })
              }
            />
          )}
          <p className="flex items-start gap-2 rounded-md bg-primary-soft p-3 text-small text-ink">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Transferência só move dinheiro entre as suas contas: não conta como gasto nem como
            receita.
          </p>
          <div className="grid gap-2">
            <Select
              label="Sai de"
              placeholder="Escolha a conta de onde sai"
              options={accountOptions([fromAccountId])}
              disabled={editing}
              error={errors.fromAccountId?.message}
              {...field("fromAccountId")}
            />
            <ArrowDown aria-hidden="true" className="mx-auto size-5 text-ink-muted" />
            <Select
              label="Entra em"
              placeholder="Escolha a conta para onde vai"
              options={accountOptions([toAccountId])}
              disabled={editing}
              help={
                editing
                  ? "Para trocar as contas, exclua esta transferência e faça outra."
                  : undefined
              }
              error={errors.toAccountId?.message}
              {...field("toAccountId")}
            />
          </div>
          {from && to && from.id !== to.id && amountCents > 0 && (
            <p aria-live="polite" className="text-small text-ink-muted">
              <span className="money font-bold text-ink">{formatBRL(amountCents)}</span> saem de{" "}
              <span className="font-bold text-ink">{from.name}</span> e entram em{" "}
              <span className="font-bold text-ink">{to.name}</span>.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Descrição"
              autoComplete="off"
              error={errors.description?.message}
              {...field("description")}
            />
            <TextField label="Data" type="date" error={errors.date?.message} {...field("date")} />
          </div>
        </>
      ) : (
        <>
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
              options={accountOptions([transaction?.account_id ?? ""])}
              error={errors.accountId?.message}
              {...accountField}
              onChange={(event) => {
                void accountField.onChange(event);
                // Fora do cartão não há parcelamento: a compra volta a ser à vista.
                if (!isCard(byId.get(event.target.value))) setValue("installments", "1");
              }}
            />
            <TextField
              label={canSplit && installmentCount > 1 ? "Data da compra" : "Data"}
              type="date"
              error={errors.date?.message}
              {...field("date")}
            />
          </div>
          {canSplit && (
            <>
              <Select
                label="Parcelas"
                options={installmentOptions}
                help="No cartão, a compra pode ser dividida em até 48 parcelas mensais."
                error={errors.installments?.message}
                {...field("installments")}
              />
              {installmentCount > 1 && (
                <InstallmentPreview totalCents={amountCents} count={installmentCount} date={date} />
              )}
            </>
          )}
        </>
      )}

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
