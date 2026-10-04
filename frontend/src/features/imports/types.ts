// Tipos das rotas de Importações (contracts/rest-api.md). Os nomes dos campos são os da API.
import type { ISODate } from "../../lib/dates";
import type { TransactionType } from "../transactions/types";

export type ImportStatus =
  | "queued"
  | "processing"
  | "awaiting_mapping"
  | "awaiting_review"
  | "completed"
  | "undone"
  | "failed";

export type ImportFormat = "ofx" | "csv" | "xlsx" | "pdf" | "image";
export type DuplicateStatus = "none" | "exact" | "probable";
export type CategorySource = "user_rule" | "ai" | "fallback";

/** A linha parece o pagamento de uma fatura e ficou como despesa: não há cartão cadastrado. */
export const INVOICE_PAYMENT_WITHOUT_CARD = "invoice_payment_without_card";

/**
 * Uma linha da revisão: a transação proposta, com o que o usuário já corrigiu nela. Nada dela
 * virou lançamento ainda (FR-046). `type`, `amount_cents`, `date` e `description` trazem o
 * valor corrigido, quando houve correção.
 */
export interface ImportItem {
  id: string;
  /** Posição da linha no arquivo, a partir de zero. */
  row_index: number;
  type: TransactionType;
  /** Só em transferência sugerida: `out` quando o dinheiro sai da conta da importação. */
  transfer_direction: "out" | "in" | null;
  /** Sempre positivo, em centavos; o sinal vem do tipo. */
  amount_cents: number;
  date: ISODate;
  description: string;
  suggested_category_id: string | null;
  category_source: CategorySource | null;
  /** A outra conta da transferência sugerida, como o cartão em um pagamento de fatura. */
  suggested_counter_account_id: string | null;
  duplicate_status: DuplicateStatus;
  duplicate_of_id: string | null;
  /** Duplicata chega desmarcada (FR-049). */
  selected_by_default: boolean;
  /** Se a linha está marcada na revisão agora; começa igual a `selected_by_default`. */
  selected: boolean;
  /** A categoria e a outra conta escolhidas na revisão; começam iguais à sugestão. */
  category_id: string | null;
  counter_account_id: string | null;
  warning_code: string | null;
  /** O que fazer, em português, quando há `warning_code`. */
  warning_message: string | null;
}

/**
 * Corpo de `PATCH /imports/{id}/items/{item_id}`: a correção de uma linha da revisão. Só os
 * campos enviados mudam; `null` em `category_id` ou `counter_account_id` desfaz a escolha.
 */
export type ImportItemPatch = Partial<
  Pick<
    ImportItem,
    | "selected"
    | "type"
    | "amount_cents"
    | "date"
    | "description"
    | "category_id"
    | "counter_account_id"
  >
>;

export type DateFormat = "dmy" | "mdy" | "ymd";
export type DecimalSeparator = "," | ".";
export type SignConvention = "negative_is_expense" | "positive_is_expense";

/**
 * Corpo de `POST /imports/{id}/mapping`. As colunas são indicadas pela posição, desde zero. O
 * valor vem de uma coluna só (`amount_column`) ou de duas, a de entrada e a de saída.
 */
export interface ColumnMapping {
  date_column: number;
  description_column: number;
  amount_column: number | null;
  income_column: number | null;
  expense_column: number | null;
  date_format: DateFormat;
  decimal_separator: DecimalSeparator;
  sign_convention: SignConvention;
}

/** Palpite do sistema pelos nomes das colunas; o usuário confirma ou troca. */
export interface MappingSuggestion extends Omit<
  ColumnMapping,
  "date_column" | "description_column"
> {
  date_column: number | null;
  description_column: number | null;
}

export interface MappingPreview {
  columns: string[];
  /** As primeiras linhas do arquivo, como estão nele. */
  rows: string[][];
  suggestion: MappingSuggestion;
}

/** O total impresso no documento contra a soma das linhas extraídas (FR-043). */
export interface TotalCheck {
  document_total_cents: number;
  extracted_total_cents: number;
  matches: boolean;
}

/** O saldo informado pelo banco contra o saldo calculado da conta na mesma data (FR-082). */
export interface BalanceCheck {
  bank_balance_cents: number;
  bank_balance_date: ISODate;
  /** Saldo da conta nessa data, sem as linhas deste arquivo. */
  account_balance_cents: number;
  /** Data de referência do saldo inicial: linhas anteriores a ela não mudam o saldo. */
  counted_from: ISODate;
  /** Com as linhas marcadas por padrão; depois da confirmação, o saldo da conta nessa data. */
  computed_balance_cents: number;
  matches: boolean;
}

export interface Import {
  id: string;
  account_id: string;
  kind: "statement" | "receipt";
  format: ImportFormat;
  original_filename: string;
  status: ImportStatus;
  error_code: string | null;
  /** O que fazer, em português, quando há `error_code`. */
  error_message: string | null;
  /** Linhas propostas pela leitura do arquivo. */
  item_count: number;
  /** Linhas que viraram lançamentos na confirmação. */
  imported_count: number;
  created_at: string;
  completed_at: string | null;
  undone_at: string | null;
  /** Até quando a importação espera o usuário, em `awaiting_mapping` e `awaiting_review`. */
  expires_at: string | null;
  /** Quando este mesmo arquivo já foi importado nesta conta. */
  already_imported_at: string | null;
  /** Só em `awaiting_mapping`. */
  mapping_preview?: MappingPreview | null;
  /** Só em `awaiting_review`. */
  items?: ImportItem[] | null;
  total_check?: TotalCheck | null;
  balance_check?: BalanceCheck | null;
}

/** Uma página do histórico, da importação mais nova para a mais antiga. */
export interface ImportPage {
  items: Import[];
  next_cursor: string | null;
}

/** A decisão final de uma linha da revisão, no corpo de `POST /imports/{id}/confirm`. */
export interface ConfirmItem {
  id: string;
  selected: boolean;
  type: TransactionType;
  amount_cents: number;
  date: ISODate;
  description: string;
  /** Obrigatória em despesa e receita; o estorno é uma receita em categoria de despesa. */
  category_id: string | null;
  /** Obrigatória em transferência: a outra conta, como o cartão em um pagamento de fatura. */
  counter_account_id: string | null;
}

/** A importação ainda está na fila ou sendo lida: a tela consulta de novo em instantes. */
export function isWorking(status: ImportStatus): boolean {
  return status === "queued" || status === "processing";
}

/** Códigos de erro de uma importação que esperou demais pelo usuário (FR-083). */
export function isExpired(record: Pick<Import, "status" | "error_code">): boolean {
  return (
    record.status === "failed" &&
    (record.error_code === "mapping_expired" || record.error_code === "review_expired")
  );
}
