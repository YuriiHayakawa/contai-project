"""Importador de CSV e de planilha Excel (research.md, seção 12).

O arquivo é lido sem IA. A estrutura dele é identificada pela assinatura do cabeçalho: se o
usuário já tem um modelo de colunas para ela, o modelo é aplicado; se não tem, o importador
pede o mapeamento, com uma prévia e um palpite pelos nomes das colunas (FR-039).
"""

import asyncio
import csv
import datetime as dt
import hashlib
import io
import re
import zipfile
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import openpyxl

from app.core.money import MINUS, decimal_to_cents
from app.modules.accounts.models import AccountType
from app.modules.imports.importers.base import (
    NO_TRANSACTIONS,
    TOO_MANY_ROWS,
    UNREADABLE,
    ImportContext,
    ImportFailed,
    MappingMismatch,
    MappingRequired,
    ProposedTransaction,
    RawDocument,
    clean_description,
)
from app.modules.imports.mapping import (
    ColumnMapping,
    DateFormat,
    MappingPreview,
    MappingSuggestion,
    SignConvention,
)
from app.modules.imports.models import ImportFormat
from app.modules.imports.storage import StoredFile, decode_text, looks_like_csv, looks_like_ofx
from app.modules.transactions.models import TransactionType
from app.modules.transactions.normalize import strip_accents

# Uma célula: texto em CSV; em planilha, também número e data, como o Excel os guarda.
Cell = str | int | float | dt.date | None
Row = tuple[Cell, ...]

MAX_ROWS = 20_000
MAX_COLUMNS = 60
# Uma planilha é um ZIP: este teto impede que um arquivo pequeno se expanda sem limite.
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
# Onde se procura o cabeçalho: bancos costumam pôr algumas linhas de título antes dele.
HEADER_SCAN_ROWS = 50
DELIMITER_SCAN_LINES = 30
PREVIEW_ROWS = 5

# Em empate, vale a ordem: ponto e vírgula é o mais comum em arquivos brasileiros.
_DELIMITERS = (";", "\t", ",", "|")
_ZIP_MAGIC = b"PK\x03\x04"
_NOT_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")
_DATE = re.compile(r"(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})")
_COMPACT_DATE = re.compile(r"\d{8}")
_LOOKS_LIKE_AMOUNT = re.compile(r"[-+(]?\s*(R\$)?\s*[-+]?\d[\d.,]*\)?\s*-?")
_NOT_AMOUNT_CHARS = re.compile(r"[^\d.,]")
_DEBIT_SUFFIX = re.compile(r"\bD\s*$", re.IGNORECASE)

# Em ordem de preferência: quando o arquivo tem "Histórico" (o tipo da operação) e "Descrição"
# (o estabelecimento), a descrição é a que serve para reconhecer e categorizar o lançamento.
_DATE_WORDS = ("data", "date", "dt", "dia")
_DESCRIPTION_WORDS = (
    "descricao",
    "description",
    "estabelecimento",
    "titulo",
    "title",
    "detalhe",
    "detalhes",
    "historico",
    "memo",
    "lancamento",
)
_AMOUNT_WORDS = ("valor", "amount", "montante", "quantia", "value")
_INCOME_WORDS = ("entrada", "entradas", "credito", "creditos", "credit")
_EXPENSE_WORDS = ("saida", "saidas", "debito", "debitos", "debit")
# "Saldo" também é dinheiro, mas não é o valor do lançamento.
_BALANCE_WORDS = frozenset({"saldo", "balance"})


@dataclass(frozen=True)
class Table:
    """O arquivo já separado em cabeçalho e linhas de dados, todas com a mesma largura."""

    columns: list[str]
    rows: list[Row]


# ---------- leitura


def detect_delimiter(text: str) -> str:
    """O separador que divide mais linhas no mesmo número de colunas."""
    lines = [line for line in text.splitlines() if line.strip()][:DELIMITER_SCAN_LINES]
    best, best_score = _DELIMITERS[0], (0, 0)
    for delimiter in _DELIMITERS:
        widths = Counter(
            width
            for line in lines
            if (width := len(next(csv.reader([line], delimiter=delimiter), []))) > 1
        )
        if not widths:
            continue
        width, count = widths.most_common(1)[0]
        if (count, width) > best_score:
            best, best_score = delimiter, (count, width)
    return best


def read_csv(content: bytes) -> list[Row]:
    text = decode_text(content)
    if text is None:
        raise ImportFailed(UNREADABLE)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=detect_delimiter(text))
    rows: list[Row] = []
    try:
        for line in reader:
            if len(rows) >= MAX_ROWS:
                raise ImportFailed(TOO_MANY_ROWS)
            rows.append(tuple(cell.strip() or None for cell in line[:MAX_COLUMNS]))
    except csv.Error as error:
        raise ImportFailed(UNREADABLE) from error
    return rows


def _xlsx_cell(value: object) -> Cell:
    if value is None or (isinstance(value, dt.date | int | float) and not isinstance(value, bool)):
        return value
    return str(value).strip() or None


def read_xlsx(content: bytes) -> list[Row]:
    """As linhas da primeira aba. Fórmulas vêm com o último valor calculado."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise ImportFailed(UNREADABLE)
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        try:
            sheet = workbook.worksheets[0]
            rows: list[Row] = []
            for line in sheet.iter_rows(values_only=True):
                if len(rows) >= MAX_ROWS:
                    raise ImportFailed(TOO_MANY_ROWS)
                rows.append(tuple(_xlsx_cell(value) for value in line[:MAX_COLUMNS]))
        finally:
            workbook.close()
    except ImportFailed:
        raise
    except Exception as error:
        # O openpyxl levanta tipos variados para planilha corrompida.
        raise ImportFailed(UNREADABLE) from error
    return rows


# ---------- cabeçalho e assinatura


def _filled(row: Row) -> int:
    return sum(cell is not None for cell in row)


def _looks_like_data(row: Row) -> bool:
    """Uma linha com data ou número é de dados, e não o cabeçalho."""
    for cell in row:
        if isinstance(cell, dt.date | int | float):
            return True
        if isinstance(cell, str) and (_DATE.search(cell) or _LOOKS_LIKE_AMOUNT.fullmatch(cell)):
            return True
    return False


def locate_table(rows: Sequence[Row]) -> Table:
    """Acha o cabeçalho, pulando as linhas de título que vêm antes dele, e separa os dados."""
    scan = rows[:HEADER_SCAN_ROWS]
    width = max((_filled(row) for row in scan), default=0)
    if width < 2:
        raise ImportFailed(UNREADABLE)
    # O cabeçalho é a primeira linha tão cheia quanto as de dados; títulos têm uma célula ou duas.
    # Em arquivo largo, uma coluna pode vir sem nome.
    threshold = width if width <= 3 else width - 1
    header_index = next(index for index, row in enumerate(scan) if _filled(row) >= threshold)
    header = rows[header_index]
    has_header = not _looks_like_data(header)
    data = rows[header_index + 1 :] if has_header else rows[header_index:]

    column_count = max(len(row) for row in (header, *data[:HEADER_SCAN_ROWS]))
    names = [str(cell) if cell is not None else "" for cell in header] if has_header else []
    columns = [
        (names[index] if index < len(names) else "") or f"Coluna {index + 1}"
        for index in range(column_count)
    ]
    table_rows = [
        (*row[:column_count], *([None] * (column_count - len(row))))
        for row in data
        if _filled(row) > 0
    ]
    if not table_rows:
        raise ImportFailed(NO_TRANSACTIONS)
    return Table(columns=columns, rows=table_rows)


def _plain(name: str) -> str:
    return " ".join(_NOT_ALPHANUMERIC.sub(" ", strip_accents(name.lower())).split())


def header_signature(columns: Sequence[str]) -> str:
    """Hash dos nomes de colunas, sem diferenciar maiúsculas, acentos ou pontuação."""
    return hashlib.sha256("|".join(_plain(name) for name in columns).encode()).hexdigest()


# ---------- palpite e prévia


def _render(cell: Cell) -> str:
    if cell is None:
        return ""
    if isinstance(cell, dt.datetime):
        return cell.date().isoformat()
    if isinstance(cell, dt.date):
        return cell.isoformat()
    if isinstance(cell, float):
        return format(Decimal(str(cell)), "f")
    return str(cell)


def _find_column(columns: Sequence[str], words: Sequence[str], taken: set[int]) -> int | None:
    """A primeira coluna livre cujo nome tem a palavra mais preferida entre as de `words`."""
    names = [set(_plain(name).split()) for name in columns]
    for word in words:
        for index, tokens in enumerate(names):
            if index not in taken and word in tokens and not tokens & _BALANCE_WORDS:
                taken.add(index)
                return index
    return None


def _guess_date_format(values: Sequence[Cell]) -> DateFormat:
    matches = [
        match for value in values if isinstance(value, str) and (match := _DATE.search(value))
    ]
    if any(len(match[1]) == 4 for match in matches):
        return DateFormat.YMD
    # Só dá para ter certeza quando algum número passa de 12; sem isso, vale o costume daqui.
    if any(int(match[2]) > 12 for match in matches) and all(
        int(match[1]) <= 12 for match in matches
    ):
        return DateFormat.MDY
    return DateFormat.DMY


def _guess_decimal_separator(values: Sequence[Cell]) -> str:
    for value in values:
        if isinstance(value, str) and (match := re.search(r"([.,])\d{1,2}\D*$", value)):
            return match[1]
    return ","


def suggest_mapping(table: Table, account_type: AccountType) -> MappingSuggestion:
    """Palpite pelos nomes das colunas e pelo jeito das primeiras linhas."""
    taken: set[int] = set()
    date_column = _find_column(table.columns, _DATE_WORDS, taken)
    description_column = _find_column(table.columns, _DESCRIPTION_WORDS, taken)
    income_column = _find_column(table.columns, _INCOME_WORDS, taken)
    expense_column = _find_column(table.columns, _EXPENSE_WORDS, taken)
    if income_column is None or expense_column is None:
        income_column = expense_column = None
    amount_column = (
        None if income_column is not None else _find_column(table.columns, _AMOUNT_WORDS, taken)
    )

    sample = table.rows[:PREVIEW_ROWS]

    def column(index: int | None) -> list[Cell]:
        return [row[index] for row in sample] if index is not None else []

    money = column(amount_column) + column(income_column) + column(expense_column)
    decimal_separator = _guess_decimal_separator(money)
    sign_convention = SignConvention.NEGATIVE_IS_EXPENSE
    if account_type == AccountType.CREDIT_CARD and amount_column is not None:
        amounts = [_read_amount(cell, decimal_separator, strict=False) for cell in money]
        # Fatura de cartão costuma trazer a compra positiva.
        if any(amounts) and all(amount is None or amount >= 0 for amount in amounts):
            sign_convention = SignConvention.POSITIVE_IS_EXPENSE
    return MappingSuggestion(
        date_column=date_column,
        description_column=description_column,
        amount_column=amount_column,
        income_column=income_column,
        expense_column=expense_column,
        date_format=_guess_date_format(column(date_column)),
        decimal_separator="." if decimal_separator == "." else ",",
        sign_convention=sign_convention,
    )


def build_preview(table: Table, account_type: AccountType) -> MappingPreview:
    return MappingPreview(
        header_signature=header_signature(table.columns),
        columns=table.columns,
        rows=[[_render(cell) for cell in row] for row in table.rows[:PREVIEW_ROWS]],
        suggestion=suggest_mapping(table, account_type),
    )


# ---------- aplicação do modelo


def _read_date(cell: Cell, date_format: DateFormat) -> dt.date | None:
    """A data da célula; `None` quando a célula não tem data (linha de total, por exemplo).

    Uma célula com números que não formam uma data no formato escolhido é sinal de modelo
    errado, e não de linha a pular.
    """
    if isinstance(cell, dt.datetime):
        return cell.date()
    if isinstance(cell, dt.date):
        return cell
    if cell is None or isinstance(cell, int | float):
        return None
    if not any(char.isdigit() for char in cell):
        return None

    match = _DATE.search(cell)
    if match is not None:
        first, second, third = match[1], match[2], match[3]
    elif _COMPACT_DATE.fullmatch(cell.strip()):
        digits = cell.strip()
        if date_format == DateFormat.YMD:
            first, second, third = digits[:4], digits[4:6], digits[6:]
        else:
            first, second, third = digits[:2], digits[2:4], digits[4:]
    else:
        raise MappingMismatch()

    # Um ano de quatro algarismos na frente não deixa dúvida, seja qual for o formato escolhido.
    if len(first) == 4 or date_format == DateFormat.YMD:
        year, month, day = first, second, third
    elif date_format == DateFormat.MDY:
        month, day, year = first, second, third
    else:
        day, month, year = first, second, third
    try:
        return dt.date(int(year) + (2000 if len(year) <= 2 else 0), int(month), int(day))
    except ValueError as error:
        raise MappingMismatch() from error


def _read_amount(cell: Cell, decimal_separator: str, *, strict: bool = True) -> int | None:
    """O valor da célula em centavos, com sinal; `None` quando a célula não tem valor.

    Aceita `R$ 1.234,56`, `-45,90`, `45,90-`, `(45,90)` e `45,90 D`.
    """
    if cell is None or isinstance(cell, dt.date):
        return None
    if isinstance(cell, int | float):
        return decimal_to_cents(Decimal(str(cell)))
    text = cell.replace("R$", "").strip()
    if not any(char.isdigit() for char in text):
        return None
    negative = (
        text.startswith(("-", MINUS, "("))
        or text.endswith("-")
        or _DEBIT_SUFFIX.search(text) is not None
    )
    digits = _NOT_AMOUNT_CHARS.sub("", text)
    thousands = "." if decimal_separator == "," else ","
    try:
        if _wrong_separator(digits, decimal_separator, thousands):
            raise InvalidOperation
        cents = decimal_to_cents(Decimal(digits.replace(thousands, "").replace(",", ".")))
    except InvalidOperation as error:
        if not strict:
            return None
        raise MappingMismatch() from error
    return -cents if negative else cents


def _wrong_separator(digits: str, decimal_separator: str, thousands: str) -> bool:
    """`45.90` com a vírgula escolhida como decimal: o ponto ali não separa milhares.

    Sem esta conferência o valor seria lido como 4590,00. Um separador de milhar é sempre
    seguido de grupos de três algarismos.
    """
    if thousands not in digits:
        return False
    integer_part = digits.split(decimal_separator, 1)[0]
    groups = integer_part.split(thousands)
    return any(len(group) != 3 for group in groups[1:])


def _unsigned(row: Row, column: int | None, mapping: ColumnMapping) -> int:
    if column is None:
        return 0
    return abs(_read_amount(row[column], mapping.decimal_separator) or 0)


def apply_mapping(rows: Sequence[Row], mapping: ColumnMapping) -> list[ProposedTransaction]:
    """Converte as linhas em transações. Linha sem data ou sem valor não é transação."""
    proposed: list[ProposedTransaction] = []
    for row in rows:
        date = _read_date(row[mapping.date_column], mapping.date_format)
        if date is None:
            continue
        if mapping.amount_column is not None:
            amount = _read_amount(row[mapping.amount_column], mapping.decimal_separator)
            if amount is not None and mapping.sign_convention == SignConvention.POSITIVE_IS_EXPENSE:
                amount = -amount
        else:
            # Colunas separadas: o sinal dentro delas não importa, só em qual o valor está.
            amount = _unsigned(row, mapping.income_column, mapping) - _unsigned(
                row, mapping.expense_column, mapping
            )
        if not amount:
            continue
        description = row[mapping.description_column]
        proposed.append(
            ProposedTransaction(
                type=TransactionType.EXPENSE if amount < 0 else TransactionType.INCOME,
                amount_cents=abs(amount),
                date=date,
                description=clean_description(_render(description)),
            )
        )
    return proposed


class TabularImporter:
    formats = frozenset({ImportFormat.CSV, ImportFormat.XLSX})

    def detect(self, head: bytes, filename: str) -> bool:
        if head.startswith(_ZIP_MAGIC):
            return True
        text = decode_text(head)
        return text is not None and not looks_like_ofx(text) and looks_like_csv(text)

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument[Row]:
        content = await file.read()
        reader = read_xlsx if file.format == ImportFormat.XLSX else read_csv
        table = locate_table(await asyncio.to_thread(reader, content))
        signature = header_signature(table.columns)
        mapping = context.templates.get(signature)
        # Um modelo que aponta para coluna que o arquivo não tem não serve para ele.
        if mapping is None or max(mapping.columns()) >= len(table.columns):
            raise MappingRequired(build_preview(table, context.account_type))
        return RawDocument(rows=table.rows, header_signature=signature)

    def normalize(self, raw: RawDocument[Row], context: ImportContext) -> list[ProposedTransaction]:
        if raw.header_signature is None:
            raise ImportFailed(UNREADABLE)
        proposed = apply_mapping(raw.rows, context.templates[raw.header_signature])
        if not proposed:
            raise ImportFailed(NO_TRANSACTIONS)
        return proposed
