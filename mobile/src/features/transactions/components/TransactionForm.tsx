import { zodResolver } from "@hookform/resolvers/zod";
import type { Account } from "@web/features/accounts/types";
import type { CategoryTree } from "@web/features/categories/types";
import { type TransactionFormValues, transactionSchema } from "@web/features/transactions/schemas";
import type { EntryType, Transaction, TransactionInput } from "@web/features/transactions/types";
import { today } from "@web/lib/dates";
import { useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Notice } from "@/components/ui/Notice";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { errorMessage } from "@/lib/api-client";
import { space } from "@/theme/tokens";

import { categoryOptions } from "../../categories/hooks/useCategories";
import { mostUsedAccountId, suggestCategoryId } from "../suggestions";
import { DateField } from "./DateField";

export interface TransactionFormProps {
  accounts: Account[];
  categories: CategoryTree;
  /** Os últimos lançamentos, base das sugestões de conta e de categoria. */
  recent: Transaction[];
  /** Na edição, o lançamento; sem ele, um lançamento novo. */
  transaction?: Transaction;
  submitLabel: string;
  onSubmit: (input: TransactionInput) => void;
  saving?: boolean;
  /** Erro da API ao salvar, mostrado acima do botão. */
  saveError?: unknown;
}

const TYPE_OPTIONS = [
  { value: "expense" as const, label: "Despesa" },
  { value: "income" as const, label: "Receita" },
];

function initialValues(props: TransactionFormProps): TransactionFormValues {
  const { transaction, recent, accounts, categories } = props;
  const base = { installments: "1", fromAccountId: "", toAccountId: "" };
  if (transaction) {
    return {
      ...base,
      type: transaction.type,
      amountCents: transaction.amount_cents,
      description: transaction.description,
      categoryId: transaction.category_id ?? "",
      accountId: transaction.account_id,
      date: transaction.date,
      notes: transaction.notes ?? "",
    };
  }
  return {
    ...base,
    type: "expense",
    amountCents: 0,
    description: "",
    categoryId: suggestCategoryId("", "expense", recent, categories) ?? "",
    accountId: mostUsedAccountId(recent, accounts) ?? "",
    date: today(),
    notes: "",
  };
}

/**
 * Lançamento de despesa ou receita, com o schema do site. Já vem com a conta mais usada, a data
 * de hoje em Brasília e a categoria sugerida pela descrição (FR-009). Uma categoria escolhida à
 * mão não muda mais sozinha.
 */
export function TransactionForm(props: TransactionFormProps) {
  const { accounts, categories, recent, transaction, submitLabel, onSubmit, saving, saveError } =
    props;
  const categoryChosen = useRef(transaction !== undefined);
  const { control, getValues, handleSubmit, setValue } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: initialValues(props),
  });
  const type = useWatch({ control, name: "type" }) === "income" ? "income" : "expense";
  const categoryId = useWatch({ control, name: "categoryId" });
  const accountId = useWatch({ control, name: "accountId" });

  // Opções: só as que recebem lançamentos novos, mais a atual de um lançamento antigo.
  const categoryChoices = categoryOptions(categories, type, { includeArchived: true })
    .filter(({ category }) => !category.archived || category.id === categoryId)
    .map(({ category, label }) => ({ value: category.id, label }));
  const accountChoices = accounts
    .filter((account) => !account.archived || account.id === accountId)
    .map((account) => ({ value: account.id, label: account.name }));

  const suggest = (description: string, kind: EntryType): void => {
    setValue("categoryId", suggestCategoryId(description, kind, recent, categories) ?? "");
  };

  const changeType = (kind: EntryType): void => {
    setValue("type", kind);
    const stillValid = categoryOptions(categories, kind).some(
      ({ category }) => category.id === categoryId,
    );
    if (!categoryChosen.current || !stillValid) {
      categoryChosen.current = false;
      suggest(getValues("description"), kind);
    }
  };

  const submit = handleSubmit((values) => {
    onSubmit({
      type: values.type === "income" ? "income" : "expense",
      amount_cents: values.amountCents,
      date: values.date,
      description: values.description,
      account_id: values.accountId,
      category_id: values.categoryId,
      notes: values.notes || null,
    });
  });

  return (
    <View style={styles.form}>
      <SegmentedControl
        label="Tipo do lançamento"
        options={TYPE_OPTIONS}
        value={type}
        onChange={changeType}
      />
      <Controller
        control={control}
        name="amountCents"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
              Valor
            </Text>
            <MoneyInput
              value={field.value}
              onChange={field.onChange}
              income={type === "income"}
              error={fieldState.error?.message}
            />
          </View>
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <TextField
            label="Descrição"
            help="Por exemplo, o nome da loja."
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              if (!categoryChosen.current) suggest(text, type);
            }}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
        )}
      />
      <Controller
        control={control}
        name="categoryId"
        render={({ field, fieldState }) => (
          <OptionPicker
            label="Categoria"
            value={field.value}
            options={categoryChoices}
            onChange={(value) => {
              categoryChosen.current = true;
              field.onChange(value);
            }}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="accountId"
        render={({ field, fieldState }) => (
          <OptionPicker
            label="Conta"
            value={field.value}
            options={accountChoices}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="date"
        render={({ field, fieldState }) => (
          <DateField
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="notes"
        render={({ field, fieldState }) => (
          <TextField
            label="Observação"
            optional
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            multiline
          />
        )}
      />
      {saveError != null && <Notice kind="error">{errorMessage(saveError)}</Notice>}
      <Button label={submitLabel} loading={saving} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[6] },
  group: { gap: space[2] },
});
