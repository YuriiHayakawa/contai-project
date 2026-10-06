import { Clock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select, type SelectOption } from "../../../components/ui/Select";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dateTimeLabel, dayLabel } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { paths } from "../../../lib/paths";
import { useDiscardImport } from "../hooks/useDiscardImport";
import { useSubmitMapping } from "../hooks/useSubmitMapping";
import { interpretRow, type InterpretedRow } from "../mapping";
import type {
  ColumnMapping,
  DateFormat,
  DecimalSeparator,
  Import,
  MappingPreview,
  SignConvention,
} from "../types";

export interface MappingStepProps {
  /** A importação em `awaiting_mapping`. */
  record: Import;
  preview: MappingPreview;
}

interface PreviewRowProps {
  row: InterpretedRow;
}

/** Como o valor aparece no arquivo: em uma coluna com sinal ou em duas, entrada e saída. */
type AmountMode = "single" | "split";
type ColumnField =
  "dateColumn" | "descriptionColumn" | "amountColumn" | "incomeColumn" | "expenseColumn";

// Campo da API → campo da tela, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, ColumnField> = {
  date_column: "dateColumn",
  description_column: "descriptionColumn",
  amount_column: "amountColumn",
  income_column: "incomeColumn",
  expense_column: "expenseColumn",
};

const REQUIRED: Record<ColumnField, string> = {
  dateColumn: "Escolha a coluna da data.",
  descriptionColumn: "Escolha a coluna da descrição.",
  amountColumn: "Escolha a coluna do valor.",
  incomeColumn: "Escolha a coluna das entradas.",
  expenseColumn: "Escolha a coluna das saídas.",
};
const COLUMN_USED_TWICE = "Cada coluna só pode ser usada uma vez. Escolha outra coluna.";

const dateFormatOptions: readonly SelectOption[] = [
  { value: "dmy", label: "Dia, mês e ano (31/12/2026)" },
  { value: "mdy", label: "Mês, dia e ano (12/31/2026)" },
  { value: "ymd", label: "Ano, mês e dia (2026-12-31)" },
];
const decimalOptions: readonly SelectOption[] = [
  { value: ",", label: "Vírgula (1.234,56)" },
  { value: ".", label: "Ponto (1,234.56)" },
];
const signOptions: readonly SelectOption[] = [
  { value: "negative_is_expense", label: "Valor negativo é saída (extrato de conta)" },
  { value: "positive_is_expense", label: "Valor positivo é gasto (fatura de cartão)" },
];
const amountModeOptions = [
  { value: "single", label: "Em uma coluna" },
  { value: "split", label: "Entrada e saída" },
] as const;

const SAMPLE_MAX_LENGTH = 24;

const columnValue = (index: number | null): string => (index === null ? "" : String(index));
const columnIndex = (value: string): number | null => (value === "" ? null : Number(value));

/** As colunas do arquivo como opções, cada uma com um exemplo do que ela traz. */
function columnOptions(preview: MappingPreview): SelectOption[] {
  return preview.columns.map((name, index) => {
    const title = name.trim() || `Coluna ${index + 1}`;
    const sample = preview.rows.map((row) => row[index]?.trim()).find(Boolean);
    const shown =
      sample && sample.length > SAMPLE_MAX_LENGTH
        ? `${sample.slice(0, SAMPLE_MAX_LENGTH)}…`
        : sample;
    return { value: String(index), label: shown ? `${title} (ex.: ${shown})` : title };
  });
}

/** Uma linha do arquivo como será importada, ou por que ela não será. */
function PreviewRow({ row }: PreviewRowProps) {
  const { date, amountCents, description } = row;
  const title = description || "Sem descrição";

  if (date.status !== "value" || amountCents.status !== "value") {
    const unreadable = date.status === "unreadable" || amountCents.status === "unreadable";
    let reason = "Linha sem data ou sem valor: não será importada.";
    if (date.status === "unreadable") {
      reason = "Não conseguimos ler a data desta linha. Confira a coluna e o formato da data.";
    } else if (amountCents.status === "unreadable") {
      reason = "Não conseguimos ler o valor desta linha. Confira a coluna e o separador decimal.";
    }
    return (
      <li className="grid gap-0.5 border-b border-border px-3 py-2.5 last:border-b-0">
        <span className="truncate text-body font-bold text-ink-muted">{title}</span>
        <span className={cn("text-small", unreadable ? "text-danger" : "text-ink-muted")}>
          {reason}
        </span>
      </li>
    );
  }

  const isIncome = amountCents.value > 0;
  return (
    // Em tela estreita a descrição usa a largura toda, e o valor desce para a linha da data.
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border",
        "px-3 py-2.5 last:border-b-0",
      )}
    >
      <span className="col-span-2 line-clamp-2 wrap-break-word text-body font-bold text-ink sm:col-span-1">
        {title}
      </span>
      <span className="truncate text-small text-ink-muted sm:col-start-1">
        {dayLabel(date.value)} · {isIncome ? "Entrada" : "Saída"}
      </span>
      <span
        className={cn(
          "money text-money-md sm:col-start-2 sm:row-span-2 sm:row-start-1",
          isIncome ? "text-income" : "text-ink",
        )}
      >
        {formatBRL(amountCents.value, { sign: "always" })}
      </span>
    </li>
  );
}

/**
 * Mapeamento de colunas de um CSV ou planilha que o Contaí não reconheceu (FR-039): o usuário
 * diz quais colunas são data, descrição e valor e vê, na hora, como as primeiras linhas serão
 * lidas. O modelo fica guardado para os próximos arquivos com as mesmas colunas.
 */
export function MappingStep({ record, preview }: MappingStepProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const submitMapping = useSubmitMapping();
  const discard = useDiscardImport();
  const { suggestion } = preview;

  const [columns, setColumns] = useState<Record<ColumnField, string>>({
    dateColumn: columnValue(suggestion.date_column),
    descriptionColumn: columnValue(suggestion.description_column),
    amountColumn: columnValue(suggestion.amount_column),
    incomeColumn: columnValue(suggestion.income_column),
    expenseColumn: columnValue(suggestion.expense_column),
  });
  const [amountMode, setAmountMode] = useState<AmountMode>(
    suggestion.income_column !== null && suggestion.expense_column !== null ? "split" : "single",
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(suggestion.date_format);
  const [decimalSeparator, setDecimalSeparator] = useState<DecimalSeparator>(
    suggestion.decimal_separator,
  );
  const [signConvention, setSignConvention] = useState<SignConvention>(suggestion.sign_convention);
  const [errors, setErrors] = useState<Partial<Record<ColumnField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const options = columnOptions(preview);
  const usedFields: ColumnField[] =
    amountMode === "single"
      ? ["dateColumn", "descriptionColumn", "amountColumn"]
      : ["dateColumn", "descriptionColumn", "incomeColumn", "expenseColumn"];

  const date = columnIndex(columns.dateColumn);
  const description = columnIndex(columns.descriptionColumn);
  const complete = usedFields.every((field) => columns[field] !== "");
  const mapping: ColumnMapping | null =
    complete && date !== null && description !== null
      ? {
          date_column: date,
          description_column: description,
          amount_column: amountMode === "single" ? columnIndex(columns.amountColumn) : null,
          income_column: amountMode === "split" ? columnIndex(columns.incomeColumn) : null,
          expense_column: amountMode === "split" ? columnIndex(columns.expenseColumn) : null,
          date_format: dateFormat,
          decimal_separator: decimalSeparator,
          sign_convention: signConvention,
        }
      : null;

  const setColumn = (field: ColumnField, value: string): void => {
    setColumns((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const columnSelect = (field: ColumnField, label: string) => (
    <Select
      label={label}
      placeholder="Escolha uma coluna"
      options={options}
      value={columns[field]}
      error={errors[field]}
      onChange={(event) => setColumn(field, event.target.value)}
    />
  );

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);
    const found: Partial<Record<ColumnField, string>> = {};
    const seen = new Set<string>();
    for (const field of usedFields) {
      const value = columns[field];
      if (value === "") found[field] = REQUIRED[field];
      else if (seen.has(value)) found[field] = COLUMN_USED_TWICE;
      seen.add(value);
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !mapping) return;

    submitMapping.mutate(
      { id: record.id, mapping },
      {
        onError: (error) => {
          const fromServer: Partial<Record<ColumnField, string>> = {};
          for (const [apiField, message] of Object.entries(fieldErrors(error))) {
            const field = API_FIELDS[apiField];
            if (field && usedFields.includes(field)) fromServer[field] = message;
          }
          if (Object.keys(fromServer).length > 0) setErrors(fromServer);
          else setFormError(errorMessage(error));
        },
      },
    );
  };

  const confirmDiscard = (): void => {
    discard.mutate(record.id, {
      onSuccess: () => {
        toast.success("Arquivo descartado. Nada foi salvo.");
        void navigate(paths.imports);
      },
      onError: (error) => {
        setConfirmingDiscard(false);
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <Card>
      <form noValidate onSubmit={submit} className="grid gap-5">
        <div className="grid gap-1.5">
          <h2 className="text-title-3 text-ink">Onde estão a data, a descrição e o valor?</h2>
          <p className="text-body wrap-anywhere text-ink-muted">
            O Contaí ainda não conhece as colunas de {record.original_filename}. Confira a escolha
            abaixo: ela fica guardada, e os próximos arquivos com as mesmas colunas não pedem isso
            de novo.
          </p>
        </div>

        {/* O modelo escolhido antes não leu o arquivo: o servidor diz o que conferir. */}
        {record.error_message && <Notice kind="error">{record.error_message}</Notice>}
        {formError && <Notice kind="error">{formError}</Notice>}

        <div className="grid gap-4 sm:grid-cols-2">
          {columnSelect("dateColumn", "Coluna da data")}
          <Select
            label="Formato da data"
            options={dateFormatOptions}
            value={dateFormat}
            onChange={(event) => setDateFormat(event.target.value as DateFormat)}
          />
          {columnSelect("descriptionColumn", "Coluna da descrição")}
          <SegmentedControl
            label="Como o valor aparece"
            options={amountModeOptions}
            value={amountMode}
            onChange={setAmountMode}
          />
          {amountMode === "single" ? (
            <>
              {columnSelect("amountColumn", "Coluna do valor")}
              <Select
                label="Sinal do valor"
                options={signOptions}
                value={signConvention}
                onChange={(event) => setSignConvention(event.target.value as SignConvention)}
              />
            </>
          ) : (
            <>
              {columnSelect("incomeColumn", "Coluna das entradas")}
              {columnSelect("expenseColumn", "Coluna das saídas")}
            </>
          )}
          <Select
            label="Separador decimal"
            options={decimalOptions}
            value={decimalSeparator}
            onChange={(event) => setDecimalSeparator(event.target.value as DecimalSeparator)}
          />
        </div>

        <section aria-labelledby="previa-importacao" className="grid gap-2">
          <h3 id="previa-importacao" className="text-label text-ink">
            Prévia das primeiras linhas
          </h3>
          {mapping ? (
            <ul aria-live="polite" className="rounded-md border border-border bg-surface">
              {preview.rows.map((row, index) => (
                <PreviewRow key={index} row={interpretRow(row, mapping)} />
              ))}
            </ul>
          ) : (
            <p className="rounded-md bg-bg-sunken p-3 text-small text-ink-muted">
              Escolha as colunas para ver como as linhas serão lidas.
            </p>
          )}
        </section>

        {record.expires_at && (
          <p className="flex items-start gap-2 text-small text-ink-muted">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              O arquivo fica guardado por 24 horas, até {dateTimeLabel(record.expires_at)}. Depois
              disso ele é apagado, e é preciso enviar de novo.
            </span>
          </p>
        )}

        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button type="submit" loading={submitMapping.isPending}>
            Usar estas colunas
          </Button>
          <Button
            variant="ghost"
            disabled={submitMapping.isPending}
            onClick={() => setConfirmingDiscard(true)}
          >
            Descartar arquivo
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmingDiscard}
        title="Descartar este arquivo?"
        description="O arquivo enviado é apagado e nada é importado. Para importar depois, envie o arquivo de novo."
        confirmLabel="Descartar arquivo"
        loading={discard.isPending}
        onConfirm={confirmDiscard}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </Card>
  );
}
