import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select, type SelectOption } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import type { Account } from "../../accounts/types";
import { categoryOptions } from "../../categories/hooks/useCategories";
import type { CategoryKind, CategoryTree } from "../../categories/types";
import { leavesAccount, type ReviewLine } from "../hooks/useImportReview";
import { reviewLineSchema, type LineKind, type ReviewLineValues } from "../schemas";

export interface ReviewLineSheetProps {
  open: boolean;
  /** A linha em edição; fica guardada depois de fechar, para a folha não esvaziar ao sair. */
  line: ReviewLine | undefined;
  /** As outras contas ativas do usuário: a outra ponta de uma transferência. */
  counterAccounts: readonly Account[];
  categories: CategoryTree;
  onSave: (values: ReviewLineValues) => void;
  onClose: () => void;
}

interface LineFormProps extends Omit<ReviewLineSheetProps, "open" | "line" | "onClose"> {
  id: string;
  line: ReviewLine;
}

const KIND_LABELS: Record<LineKind, string> = {
  expense: "Despesa",
  income: "Receita",
  refund: "Estorno",
  transfer: "Transferência",
};

const KIND_NOTES: Partial<Record<LineKind, string>> = {
  refund:
    "Estorno é o dinheiro de uma compra que voltou: o valor abate o gasto da categoria da compra, em vez de contar como receita.",
  transfer:
    "Transferência só move dinheiro entre as suas contas: não conta como gasto nem como receita. O pagamento da fatura é uma transferência para o cartão.",
};

const DUPLICATE_NOTES = {
  exact:
    "Esta linha já foi importada nesta conta. Deixe desmarcada, a não ser que queira lançar de novo.",
  probable:
    "Já existe nesta conta um lançamento do mesmo valor em data próxima. Marque a linha só se for outro lançamento.",
} as const;

/** A lista de categorias de cada tipo de linha: o estorno fica na categoria da compra. */
const categoryKindOf = (kind: LineKind): CategoryKind => (kind === "income" ? "income" : "expense");

function LineForm({ id, line, counterAccounts, categories, onSave }: LineFormProps) {
  const amountId = useId();
  const outflow = leavesAccount(line.item);
  const {
    register: field,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<ReviewLineValues>({
    resolver: zodResolver(reviewLineSchema),
    defaultValues: {
      kind: line.kind,
      amountCents: line.amountCents,
      description: line.description,
      notes: line.notes,
      date: line.date,
      categoryId: line.categoryId,
      counterAccountId: line.counterAccountId,
    },
  });
  const kind = useWatch({ control, name: "kind" });

  // O sentido do dinheiro é o do extrato: uma saída não vira receita, nem uma entrada, despesa.
  const kinds: LineKind[] = outflow ? ["expense", "transfer"] : ["income", "refund", "transfer"];

  const categorySelectOptions: SelectOption[] = categoryOptions(
    categories,
    categoryKindOf(kind),
  ).map(({ category, label }) => ({ value: category.id, label }));
  const accountOptions: SelectOption[] = counterAccounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  const changeKind = (next: LineKind): void => {
    setValue("kind", next, { shouldDirty: true });
    if (next === "transfer") {
      // Com um cartão só, o pagamento de fatura já vem apontado para ele.
      const cards = counterAccounts.filter((account) => account.type === "credit_card");
      const only = outflow && cards.length === 1 ? cards[0] : undefined;
      if (!getValues("counterAccountId") && only) setValue("counterAccountId", only.id);
      return;
    }
    // As categorias de receita e as de despesa são listas diferentes: a escolhida pode não valer.
    const stillValid = categoryOptions(categories, categoryKindOf(next)).some(
      ({ category }) => category.id === getValues("categoryId"),
    );
    if (!stillValid) setValue("categoryId", "");
  };

  const { warning_message: warning, duplicate_status: duplicate } = line.item;
  const note = KIND_NOTES[kind];

  return (
    <form
      id={id}
      noValidate
      onSubmit={(event) => void handleSubmit(onSave)(event)}
      className="grid gap-4"
    >
      {/* O aviso de pagamento de fatura vale enquanto a linha conta como despesa. */}
      {warning && kind === "expense" && <Notice kind="warning">{warning}</Notice>}
      {duplicate !== "none" && <Notice kind="warning">{DUPLICATE_NOTES[duplicate]}</Notice>}

      <SegmentedControl
        label="Tipo da linha"
        options={kinds.map((value) => ({ value, label: KIND_LABELS[value] }))}
        value={kind}
        onChange={changeKind}
      />
      {note && (
        <p className="flex items-start gap-2 rounded-md bg-primary-soft p-3 text-small text-ink">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          {note}
        </p>
      )}

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
              ref={amount.ref}
              tone={outflow || kind === "transfer" ? "ink" : "income"}
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
        help="O nome que aparece nos seus lançamentos. Troque o texto do banco por um que você reconheça."
        error={errors.description?.message}
        {...field("description")}
      />

      {kind === "transfer" ? (
        <Select
          label={outflow ? "Entra em" : "Saiu de"}
          placeholder={outflow ? "Escolha a conta para onde vai" : "Escolha a conta de onde veio"}
          options={accountOptions}
          help={
            accountOptions.length === 0
              ? "Você ainda não tem outra conta. Cadastre o cartão ou a outra conta em Contas e volte para marcar esta linha."
              : undefined
          }
          error={errors.counterAccountId?.message}
          {...field("counterAccountId")}
        />
      ) : (
        <Select
          label={kind === "refund" ? "Categoria da compra" : "Categoria"}
          placeholder="Escolha uma categoria"
          options={categorySelectOptions}
          help="Se você trocar a categoria, as próximas linhas com esta descrição já vêm com ela."
          error={errors.categoryId?.message}
          {...field("categoryId")}
        />
      )}

      <TextField label="Data" type="date" error={errors.date?.message} {...field("date")} />

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

/**
 * Folha para editar uma linha da revisão (FR-046), com os mesmos campos de um lançamento feito
 * à mão: tipo, valor, descrição, categoria ou a outra conta, data e observação. Uma entrada
 * pode ser marcada como estorno de uma compra (FR-084), e uma saída, como transferência para o
 * cartão, que é o pagamento da fatura (FR-081). Ao salvar, a edição é guardada na revisão; a
 * linha só vira lançamento na confirmação.
 */
export function ReviewLineSheet({
  open,
  line,
  counterAccounts,
  categories,
  onSave,
  onClose,
}: ReviewLineSheetProps) {
  const formId = useId();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar lançamento"
      size="form"
      footer={
        <>
          <Button type="submit" form={formId}>
            Salvar alterações
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      {line && (
        <LineForm
          // Cada linha, e cada correção dela, começa com os valores de agora.
          key={`${line.item.id}-${open}`}
          id={formId}
          line={line}
          counterAccounts={counterAccounts}
          categories={categories}
          onSave={onSave}
        />
      )}
    </Modal>
  );
}
