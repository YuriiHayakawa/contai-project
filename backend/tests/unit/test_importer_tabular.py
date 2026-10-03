"""Importador de CSV e planilha: leitura, pedido de mapeamento e aplicação do modelo."""

import io
import zipfile
from datetime import date, datetime

import openpyxl
import pytest

from app.modules.accounts.models import AccountType
from app.modules.imports.importers import tabular
from app.modules.imports.importers.base import (
    NO_TRANSACTIONS,
    TOO_MANY_ROWS,
    UNREADABLE,
    ImportContext,
    ImportFailed,
    MappingMismatch,
    MappingRequired,
)
from app.modules.imports.importers.tabular import (
    Row,
    TabularImporter,
    apply_mapping,
    detect_delimiter,
    header_signature,
    locate_table,
    read_csv,
    read_xlsx,
)
from app.modules.imports.mapping import (
    ColumnMapping,
    DateFormat,
    MappingPreview,
    SignConvention,
)
from app.modules.transactions.models import TransactionType
from tests.imports import fixture_bytes, read_with, stored_file

EXPENSE, INCOME = TransactionType.EXPENSE, TransactionType.INCOME

importer = TabularImporter()

# Data, descrição e valor nas três primeiras colunas, do jeito mais comum por aqui.
SIMPLE = ColumnMapping(date_column=0, description_column=1, amount_column=2)


async def _preview(
    content: bytes, account_type: AccountType = AccountType.CHECKING
) -> MappingPreview:
    """A prévia que o importador devolve quando não conhece a estrutura do arquivo."""
    with pytest.raises(MappingRequired) as required:
        await importer.extract(await stored_file(content), ImportContext(account_type=account_type))
    return required.value.preview


def _summary(
    rows: list[Row], mapping: ColumnMapping = SIMPLE
) -> list[tuple[date, TransactionType, int]]:
    return [(item.date, item.type, item.amount_cents) for item in apply_mapping(rows, mapping)]


# ---------- leitura


@pytest.mark.parametrize(
    ("text", "delimiter"),
    [
        ("Data;Descrição;Valor\n01/09/2026;Padaria;-45,90\n02/09/2026;Mercado;-10,00", ";"),
        ("date,title,amount\n2026-09-01,Padaria,45.90\n2026-09-02,Mercado,10.00", ","),
        ("Data\tDescrição\tValor\n01/09/2026\tPadaria\t-45,90", "\t"),
        ("Data|Descrição|Valor\n01/09/2026|Padaria|-45,90", "|"),
        # A vírgula decimal aparece em toda linha de dados, mas não divide o cabeçalho.
        ("Data;Valor\n01/09/2026;-45,90\n02/09/2026;-10,00\n03/09/2026;-1,00", ";"),
        ('date,title,amount\n2026-09-01,"Café; padaria",7.50', ","),
    ],
    ids=["ponto e vírgula", "vírgula", "tabulação", "barra", "vírgula decimal", "texto com ;"],
)
def test_detects_the_delimiter(text: str, delimiter: str) -> None:
    assert detect_delimiter(text) == delimiter


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp1252", "utf-16"])
def test_reads_the_file_in_the_encodings_banks_use(encoding: str) -> None:
    content = "Data;Descrição;Valor\n01/09/2026;Pão de açúcar;-45,90\n".encode(encoding)

    table = locate_table(read_csv(content))

    assert table.columns == ["Data", "Descrição", "Valor"]
    assert table.rows == [("01/09/2026", "Pão de açúcar", "-45,90")]


def test_skips_title_lines_before_the_header_and_reads_quoted_cells() -> None:
    table = locate_table(read_csv(fixture_bytes("extrato_ponto_e_virgula.csv")))

    assert table.columns == ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"]
    assert table.rows[2][1] == "SUPERMERCADO BOM PREÇO; LOJA 2"
    assert len(table.rows) == 5


def test_a_file_without_a_header_gets_numbered_columns() -> None:
    table = locate_table(read_csv(b"01/09/2026;Padaria;-45,90\n02/09/2026;Mercado;-10,00\n"))

    assert table.columns == ["Coluna 1", "Coluna 2", "Coluna 3"]
    assert len(table.rows) == 2


def test_a_column_without_a_name_gets_a_number() -> None:
    table = locate_table(read_csv(b"Data;Descricao;;Valor\n01/09/2026;Padaria;x;-45,90\n"))

    assert table.columns == ["Data", "Descricao", "Coluna 3", "Valor"]


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"uma linha so sem colunas\noutra linha\n", UNREADABLE),
        (b"Data;Descricao;Valor\n", NO_TRANSACTIONS),
        (b"\x00\x01\x02\x03", UNREADABLE),
    ],
    ids=["uma coluna só", "só o cabeçalho", "binário"],
)
def test_a_csv_that_cannot_be_imported_fails_with_a_code(content: bytes, code: str) -> None:
    with pytest.raises(ImportFailed) as failure:
        locate_table(read_csv(content))

    assert failure.value.code == code


def test_a_file_with_too_many_rows_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tabular, "MAX_ROWS", 3)

    with pytest.raises(ImportFailed) as failure:
        read_csv(b"Data;Valor\n" + b"01/09/2026;1,00\n" * 3)

    assert failure.value.code == TOO_MANY_ROWS


# ---------- assinatura do cabeçalho


def test_the_signature_ignores_case_accents_and_punctuation() -> None:
    assert header_signature(["Data", "Histórico", "Valor (R$)"]) == header_signature(
        ["DATA", "historico", " valor r$ "]
    )


def test_the_signature_changes_with_the_columns_and_their_order() -> None:
    original = header_signature(["Data", "Descrição", "Valor"])

    assert header_signature(["Data", "Valor", "Descrição"]) != original
    assert header_signature(["Data", "Descrição", "Valor", "Saldo"]) != original


# ---------- pedido de mapeamento


async def test_without_a_template_asks_for_the_mapping_with_a_preview_and_a_guess() -> None:
    preview = await _preview(fixture_bytes("extrato_ponto_e_virgula.csv"))

    assert preview.columns == ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"]
    assert preview.rows[0] == [
        "05/09/2026",
        "SALÁRIO EMPRESA FICTÍCIA LTDA",
        "000123",
        "5.450,00",
        "5.950,00",
    ]
    assert len(preview.rows) == 5
    # O palpite não confunde o saldo com o valor do lançamento.
    assert preview.suggestion.model_dump() == {
        "date_column": 0,
        "description_column": 1,
        "amount_column": 3,
        "income_column": None,
        "expense_column": None,
        "date_format": DateFormat.DMY,
        "decimal_separator": ",",
        "sign_convention": SignConvention.NEGATIVE_IS_EXPENSE,
    }
    assert preview.header_signature == header_signature(preview.columns)


async def test_the_guess_follows_the_format_of_the_file() -> None:
    suggestion = (await _preview(fixture_bytes("fatura_virgula.csv"))).suggestion

    assert suggestion.date_format == DateFormat.YMD
    assert suggestion.decimal_separator == "."
    assert (suggestion.date_column, suggestion.description_column, suggestion.amount_column) == (
        0,
        1,
        2,
    )


async def test_the_guess_finds_separate_income_and_expense_columns() -> None:
    suggestion = (await _preview(fixture_bytes("extrato_entrada_saida.csv"))).suggestion

    assert (suggestion.income_column, suggestion.expense_column) == (2, 3)
    assert suggestion.amount_column is None


async def test_on_a_credit_card_positive_amounts_are_guessed_as_purchases() -> None:
    content = b"date,title,amount\n2026-09-12,Livraria,59.90\n2026-09-18,Cafe,7.50\n"

    card = (await _preview(content, AccountType.CREDIT_CARD)).suggestion
    checking = (await _preview(content, AccountType.CHECKING)).suggestion

    assert card.sign_convention == SignConvention.POSITIVE_IS_EXPENSE
    assert checking.sign_convention == SignConvention.NEGATIVE_IS_EXPENSE


async def test_columns_with_unknown_names_are_left_for_the_user_to_choose() -> None:
    suggestion = (await _preview(b"A;B;C\n01/09/2026;Padaria;-45,90\n")).suggestion

    assert (suggestion.date_column, suggestion.description_column, suggestion.amount_column) == (
        None,
        None,
        None,
    )


async def test_american_dates_are_guessed_when_the_day_cannot_be_first() -> None:
    suggestion = (await _preview(b"Date;Description;Amount\n09/25/2026;Store;-10.00\n")).suggestion

    assert suggestion.date_format == DateFormat.MDY


# ---------- aplicação do modelo


async def test_applies_a_saved_template_to_a_file_with_the_same_structure() -> None:
    content = fixture_bytes("extrato_ponto_e_virgula.csv")
    signature = (await _preview(content)).header_signature
    mapping = ColumnMapping(date_column=0, description_column=1, amount_column=3)

    proposed = await read_with(importer, content, templates={signature: mapping})

    assert [(item.date, item.type, item.amount_cents, item.description) for item in proposed] == [
        (date(2026, 9, 5), INCOME, 545_000, "SALÁRIO EMPRESA FICTÍCIA LTDA"),
        (date(2026, 9, 10), EXPENSE, 4_590, "PADARIA SÃO JOÃO"),
        (date(2026, 9, 15), EXPENSE, 18_937, "SUPERMERCADO BOM PREÇO; LOJA 2"),
        (date(2026, 9, 20), EXPENSE, 120_000, "PIX ENVIADO JOÃO"),
    ]
    # A linha do saldo final, sem data, não é transação; e nenhuma tem identificador do banco.
    assert all(item.external_id is None for item in proposed)


async def test_a_template_that_points_to_a_missing_column_asks_for_the_mapping_again() -> None:
    content = b"Data;Descricao;Valor\n01/09/2026;Padaria;-45,90\n"
    signature = header_signature(["Data", "Descricao", "Valor"])
    mapping = ColumnMapping(date_column=0, description_column=1, amount_column=7)

    with pytest.raises(MappingRequired):
        await read_with(importer, content, templates={signature: mapping})


@pytest.mark.parametrize(
    ("cell", "date_format", "expected"),
    [
        ("15/09/2026", DateFormat.DMY, date(2026, 9, 15)),
        ("15-09-2026", DateFormat.DMY, date(2026, 9, 15)),
        ("15.09.2026", DateFormat.DMY, date(2026, 9, 15)),
        ("5/9/26", DateFormat.DMY, date(2026, 9, 5)),
        ("15/09/2026 13:45", DateFormat.DMY, date(2026, 9, 15)),
        ("15092026", DateFormat.DMY, date(2026, 9, 15)),
        ("09/15/2026", DateFormat.MDY, date(2026, 9, 15)),
        ("2026-09-15", DateFormat.YMD, date(2026, 9, 15)),
        ("20260915", DateFormat.YMD, date(2026, 9, 15)),
        ("26/09/15", DateFormat.YMD, date(2026, 9, 15)),
        # Ano de quatro algarismos na frente não deixa dúvida, seja qual for o formato escolhido.
        ("2026-09-15T10:00:00", DateFormat.DMY, date(2026, 9, 15)),
    ],
)
def test_date_formats(cell: str, date_format: DateFormat, expected: date) -> None:
    mapping = SIMPLE.model_copy(update={"date_format": date_format})

    assert _summary([(cell, "Compra", "-1,00")], mapping) == [(expected, EXPENSE, 100)]


@pytest.mark.parametrize(
    ("cell", "decimal_separator", "expected"),
    [
        ("-45,90", ",", (EXPENSE, 4_590)),
        ("45,90", ",", (INCOME, 4_590)),
        ("-1.234,56", ",", (EXPENSE, 123_456)),
        ("R$ 1.234,56", ",", (INCOME, 123_456)),
        ("-R$ 45,90", ",", (EXPENSE, 4_590)),
        ("R$ -45,90", ",", (EXPENSE, 4_590)),
        ("\N{MINUS SIGN}45,90", ",", (EXPENSE, 4_590)),
        ("45,90-", ",", (EXPENSE, 4_590)),
        ("(45,90)", ",", (EXPENSE, 4_590)),
        ("45,90 D", ",", (EXPENSE, 4_590)),
        ("45,90 C", ",", (INCOME, 4_590)),
        ("+45", ",", (INCOME, 4_500)),
        ("1.234", ",", (INCOME, 123_400)),
        ("-45.90", ".", (EXPENSE, 4_590)),
        ("1,234.56", ".", (INCOME, 123_456)),
        ("1234.5", ".", (INCOME, 123_450)),
    ],
)
def test_decimal_formats(
    cell: str, decimal_separator: str, expected: tuple[TransactionType, int]
) -> None:
    mapping = SIMPLE.model_copy(update={"decimal_separator": decimal_separator})

    assert _summary([("15/09/2026", "Compra", cell)], mapping) == [(date(2026, 9, 15), *expected)]


@pytest.mark.parametrize(
    ("row", "mapping"),
    [
        # Dia 25 no lugar do mês: o formato de data escolhido está errado.
        (("09/25/2026", "Compra", "-1,00"), SIMPLE),
        (("31/02/2026", "Compra", "-1,00"), SIMPLE),
        (("15 de set. de 2026", "Compra", "-1,00"), SIMPLE),
        # Com a vírgula como decimal, "45.90" viraria R$ 4.590,00.
        (("15/09/2026", "Compra", "-45.90"), SIMPLE),
        (("15/09/2026", "Compra", "45,90"), SIMPLE.model_copy(update={"decimal_separator": "."})),
        (("15/09/2026", "Compra", "1.2.3,4,5"), SIMPLE),
    ],
    ids=[
        "mês 25",
        "dia que não existe",
        "data por extenso",
        "ponto como decimal",
        "vírgula como decimal",
        "valor ilegível",
    ],
)
def test_a_row_the_template_cannot_read_means_the_template_is_wrong(
    row: Row, mapping: ColumnMapping
) -> None:
    # Ler errado em silêncio seria pior que parar: o usuário confere as colunas e manda de novo.
    with pytest.raises(MappingMismatch):
        apply_mapping([row], mapping)


def test_rows_without_a_date_or_without_an_amount_are_not_transactions() -> None:
    rows: list[Row] = [
        ("15/09/2026", "Compra", "-1,00"),
        (None, "Saldo final", "4.514,73"),
        ("Total", None, "-1,00"),
        ("16/09/2026", "Sem valor", None),
        ("16/09/2026", "Valor zero", "0,00"),
        ("16/09/2026", "Traço no lugar do valor", "-"),
    ]

    assert _summary(rows) == [(date(2026, 9, 15), EXPENSE, 100)]


def test_on_a_card_statement_the_positive_amount_is_the_purchase() -> None:
    mapping = ColumnMapping(
        date_column=0,
        description_column=1,
        amount_column=2,
        date_format=DateFormat.YMD,
        decimal_separator=".",
        sign_convention=SignConvention.POSITIVE_IS_EXPENSE,
    )
    table = locate_table(read_csv(fixture_bytes("fatura_virgula.csv")))

    assert _summary(table.rows, mapping) == [
        (date(2026, 9, 12), EXPENSE, 5_990),
        (date(2026, 9, 18), EXPENSE, 750),
        (date(2026, 9, 21), EXPENSE, 21_000),
        (date(2026, 9, 25), INCOME, 5_990),
    ]


def test_separate_income_and_expense_columns() -> None:
    mapping = ColumnMapping(date_column=0, description_column=1, income_column=2, expense_column=3)
    table = locate_table(read_csv(fixture_bytes("extrato_entrada_saida.csv")))

    assert _summary(table.rows, mapping) == [
        (date(2026, 9, 5), INCOME, 545_000),
        (date(2026, 9, 10), EXPENSE, 4_590),
        (date(2026, 9, 13), INCOME, 10_000),
        (date(2026, 9, 15), EXPENSE, 23_015),
    ]


def test_in_separate_columns_the_sign_inside_them_does_not_matter() -> None:
    mapping = ColumnMapping(date_column=0, description_column=1, income_column=2, expense_column=3)

    assert _summary([("15/09/2026", "Compra", None, "-45,90")], mapping) == [
        (date(2026, 9, 15), EXPENSE, 4_590)
    ]


def test_an_empty_description_gets_a_placeholder_and_a_long_one_is_cut() -> None:
    rows: list[Row] = [("15/09/2026", None, "-1,00"), ("15/09/2026", "x" * 300, "-1,00")]

    first, second = apply_mapping(rows, SIMPLE)

    assert first.description == "Lançamento sem descrição"
    assert len(second.description) == 200


async def test_a_file_whose_rows_are_all_skipped_has_no_transactions() -> None:
    content = b"Data;Descricao;Valor\n;Saldo final;100,00\n"
    signature = header_signature(["Data", "Descricao", "Valor"])

    with pytest.raises(ImportFailed) as failure:
        await read_with(importer, content, templates={signature: SIMPLE})

    assert failure.value.code == NO_TRANSACTIONS


# ---------- planilha Excel


def _workbook(*rows: list[object]) -> bytes:
    workbook = openpyxl.Workbook()
    for row in rows:
        workbook.active.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def test_reads_a_spreadsheet_with_dates_and_numbers_as_excel_stores_them() -> None:
    content = fixture_bytes("extrato.xlsx")
    preview = await _preview(content)

    assert preview.columns == ["Data", "Descrição", "Valor"]
    assert preview.rows[:2] == [
        ["2026-09-05", "Salário", "5450"],
        ["2026-09-10", "Padaria São João", "-45.9"],
    ]

    proposed = await read_with(importer, content, templates={preview.header_signature: SIMPLE})

    # A vírgula escolhida como decimal não atrapalha: o número da planilha não é texto.
    assert [(item.date, item.type, item.amount_cents) for item in proposed] == [
        (date(2026, 9, 5), INCOME, 545_000),
        (date(2026, 9, 10), EXPENSE, 4_590),
        (date(2026, 9, 15), EXPENSE, 18_937),
    ]


def test_a_spreadsheet_with_text_cells_is_read_like_a_csv() -> None:
    content = _workbook(["Data", "Descrição", "Valor"], ["15/09/2026", "Padaria", "-45,90"])

    table = locate_table(read_xlsx(content))

    assert _summary(table.rows) == [(date(2026, 9, 15), EXPENSE, 4_590)]


def test_a_date_with_time_keeps_only_the_date() -> None:
    content = _workbook(
        ["Data", "Descrição", "Valor"], [datetime(2026, 9, 15, 23, 59), "Compra", -1]
    )

    assert _summary(locate_table(read_xlsx(content)).rows) == [(date(2026, 9, 15), EXPENSE, 100)]


def test_a_corrupted_spreadsheet_fails_as_unreadable() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", "isto não é uma planilha")

    with pytest.raises(ImportFailed) as failure:
        read_xlsx(buffer.getvalue())

    assert failure.value.code == UNREADABLE


def test_a_spreadsheet_that_expands_beyond_the_limit_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tabular, "MAX_UNCOMPRESSED_BYTES", 100)

    with pytest.raises(ImportFailed) as failure:
        read_xlsx(fixture_bytes("extrato.xlsx"))

    assert failure.value.code == UNREADABLE


# ---------- reconhecimento


def test_detects_tables_and_leaves_ofx_to_its_importer() -> None:
    assert importer.detect(b"Data;Valor\n01/09/2026;10,00", "extrato.txt")
    assert importer.detect(fixture_bytes("extrato.xlsx")[:100], "extrato.bin")
    assert not importer.detect(b"<OFX><BANKMSGSRSV1>;", "extrato.csv")
    assert not importer.detect(b"texto corrido sem colunas", "extrato.csv")
