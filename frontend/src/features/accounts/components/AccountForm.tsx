import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Checkbox } from "../../../components/ui/Checkbox";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { Notice } from "../../../components/ui/Notice";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { errorMessage, fieldErrors, isApiError } from "../../../lib/api-client";
import { today } from "../../../lib/dates";
import { accountSchema, type AccountFormValues } from "../schemas";
import { ACCOUNT_TYPE_LABELS, type Account, type AccountInput, type AccountType } from "../types";

export interface AccountFormProps {
  /** Id do `<form>`: o botão de salvar fica no rodapé da folha e aponta para ele. */
  id: string;
  /** Conta em edição; sem ela, o formulário cadastra uma conta nova. */
  account?: Account;
  /** Salva a conta. Se rejeitar, a mensagem do servidor aparece no campo ou no topo. */
  onSubmit: (input: AccountInput) => Promise<unknown>;
  /** Avisa quando há dados digitados e não salvos, para a folha não fechar sem querer. */
  onDirtyChange?: (dirty: boolean) => void;
}

// Campo da API → campo do formulário, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, keyof AccountFormValues> = {
  name: "name",
  type: "type",
  institution: "institution",
  initial_balance_cents: "balanceCents",
  initial_balance_date: "balanceDate",
  closing_day: "closingDay",
  due_day: "dueDay",
  credit_limit_cents: "limitCents",
};

const typeOptions = (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((value) => ({
  value,
  label: ACCOUNT_TYPE_LABELS[value],
}));

function initialValues(account: Account | undefined): AccountFormValues {
  return {
    name: account?.name ?? "",
    type: account?.type ?? "checking",
    institution: account?.institution ?? "",
    balanceCents: Math.abs(account?.initial_balance_cents ?? 0),
    negative: (account?.initial_balance_cents ?? 0) < 0,
    balanceDate: account?.initial_balance_date ?? today(),
    closingDay: account?.closing_day?.toString() ?? "",
    dueDay: account?.due_day?.toString() ?? "",
    limitCents: account?.credit_limit_cents ?? 0,
  };
}

function toInput(values: AccountFormValues): AccountInput {
  const isCard = values.type === "credit_card";
  // No cartão o valor é sempre uma dívida: vai negativo, e zero continua zero.
  const owes = isCard || values.negative;
  return {
    name: values.name,
    type: values.type,
    institution: values.institution || null,
    initial_balance_cents:
      owes && values.balanceCents > 0 ? -values.balanceCents : values.balanceCents,
    initial_balance_date: values.balanceDate,
    closing_day: isCard ? Number(values.closingDay) : null,
    due_day: isCard ? Number(values.dueDay) : null,
    credit_limit_cents: isCard && values.limitCents > 0 ? values.limitCents : null,
  };
}

/**
 * Formulário de conta: nome, tipo, instituição e saldo inicial. No cartão, o valor inicial é
 * quanto já se deve nele, e entram os dias da fatura e o limite, que é um teto e não entra no
 * saldo (FR-019, FR-088).
 */
export function AccountForm({ id, account, onSubmit, onDirtyChange }: AccountFormProps) {
  const balanceId = useId();
  const balanceHelpId = useId();
  const limitId = useId();
  const limitHelpId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register: field,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: initialValues(account),
  });
  const isCard = useWatch({ control, name: "type" }) === "credit_card";

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toInput(values));
    } catch (error) {
      const byField = Object.entries(fieldErrors(error)).flatMap(([apiField, message]) => {
        const formField = API_FIELDS[apiField];
        return formField ? [[formField, message] as const] : [];
      });
      // O nome repetido chega como conflito, sem campo: o lugar dele é junto do nome.
      if (isApiError(error) && error.code === "account_name_taken") {
        byField.push(["name", error.message]);
      }
      for (const [formField, message] of byField) {
        setError(formField, { message }, { shouldFocus: true });
      }
      if (byField.length === 0) setFormError(errorMessage(error));
    }
  });

  return (
    <form id={id} noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {formError && <Notice kind="error">{formError}</Notice>}

      <TextField
        label="Nome"
        autoComplete="off"
        placeholder="Como você chama esta conta"
        error={errors.name?.message}
        {...field("name")}
      />
      <Select label="Tipo" options={typeOptions} error={errors.type?.message} {...field("type")} />
      <TextField
        label="Banco ou instituição"
        optional
        autoComplete="off"
        error={errors.institution?.message}
        {...field("institution")}
      />

      <div className="grid gap-1.5">
        <label htmlFor={balanceId} className="text-label text-ink">
          {isCard ? "Quanto você já deve neste cartão" : "Saldo inicial"}
        </label>
        <Controller
          control={control}
          name="balanceCents"
          render={({ field: balance }) => (
            <MoneyInput
              id={balanceId}
              ref={balance.ref}
              aria-label={
                isCard ? "Quanto você já deve neste cartão, em reais" : "Saldo inicial em reais"
              }
              aria-describedby={isCard ? balanceHelpId : undefined}
              value={balance.value}
              onChange={balance.onChange}
              onBlur={balance.onBlur}
              error={errors.balanceCents?.message}
            />
          )}
        />
        {isCard ? (
          // No cartão o valor é sempre uma dívida: não há caixa para marcar.
          <p id={balanceHelpId} className="text-small text-ink-muted">
            Deixe em zero se a fatura está em dia. O limite do cartão não entra aqui: ele tem o
            próprio campo, mais abaixo.
          </p>
        ) : (
          <Checkbox {...field("negative")}>O saldo está negativo</Checkbox>
        )}
      </div>

      <TextField
        label="Data do saldo inicial"
        type="date"
        help="Só os lançamentos a partir deste dia mudam o saldo da conta."
        error={errors.balanceDate?.message}
        {...field("balanceDate")}
      />

      {isCard && (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Dia do fechamento"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            error={errors.closingDay?.message}
            {...field("closingDay")}
          />
          <TextField
            label="Dia do vencimento"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            error={errors.dueDay?.message}
            {...field("dueDay")}
          />
          <p className="col-span-2 text-small text-ink-muted">
            Compras a partir do dia do fechamento já vão para a fatura seguinte; o vencimento é o
            dia de pagar. Ex.: fecha dia 3 e vence dia 10.
          </p>
        </div>
      )}

      {isCard && (
        <div className="grid gap-1.5">
          <label htmlFor={limitId} className="text-label text-ink">
            Limite do cartão <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <Controller
            control={control}
            name="limitCents"
            render={({ field: limit }) => (
              <MoneyInput
                id={limitId}
                ref={limit.ref}
                aria-label="Limite do cartão em reais"
                aria-describedby={limitHelpId}
                value={limit.value}
                onChange={limit.onChange}
                onBlur={limit.onBlur}
                error={errors.limitCents?.message}
              />
            )}
          />
          <p id={limitHelpId} className="text-small text-ink-muted">
            É o teto do cartão, e não dinheiro seu: serve para mostrar quanto ainda dá para gastar.
            Deixe em zero para não acompanhar.
          </p>
        </div>
      )}
    </form>
  );
}
