"""Importador de OFX: arquivos de três bancos fictícios, um deles fora do padrão."""

from datetime import date

import pytest

from app.modules.accounts.models import AccountType
from app.modules.imports.importers.base import (
    MULTIPLE_ACCOUNTS,
    NO_TRANSACTIONS,
    UNREADABLE,
    ImportContext,
    ImportFailed,
)
from app.modules.imports.importers.ofx import OfxImporter, parse_amount, parse_date, parse_ofx
from app.modules.transactions.models import TransactionType
from tests.imports import fixture_bytes, read_with

EXPENSE, INCOME = TransactionType.EXPENSE, TransactionType.INCOME
CONTEXT = ImportContext(account_type=AccountType.CHECKING)

importer = OfxImporter()


def _statement(transactions: str, *, tail: str = "") -> bytes:
    return (
        "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>"
        f"{transactions}</BANKTRANLIST>{tail}</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
    ).encode()


def _transaction(*, amount: str = "-10.00", posted: str = "20260910", fitid: str = "F1") -> str:
    return (
        f"<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>{posted}<TRNAMT>{amount}"
        f"<FITID>{fitid}<MEMO>COMPRA</STMTTRN>"
    )


def _summary(content: bytes) -> list[tuple[date, TransactionType, int, str, str | None]]:
    proposed = importer.normalize(parse_ofx(content), CONTEXT)
    return [
        (item.date, item.type, item.amount_cents, item.description, item.external_id)
        for item in proposed
    ]


def test_reads_a_standard_statement_with_the_fitid_as_external_id() -> None:
    assert _summary(fixture_bytes("banco_azul.ofx")) == [
        (date(2026, 9, 5), INCOME, 545_000, "SALÁRIO EMPRESA FICTÍCIA LTDA", "20260905001"),
        (date(2026, 9, 10), EXPENSE, 4_590, "PADARIA SÃO JOÃO", "20260910001"),
        (date(2026, 9, 15), EXPENSE, 18_937, "SUPERMERCADO BOM PREÇO", "20260915001"),
        (date(2026, 9, 15), EXPENSE, 1_200, "TARIFA PACOTE DE SERVIÇOS", "20260915002"),
        (date(2026, 9, 20), EXPENSE, 80_000, "PAGAMENTO FATURA CARTÃO", "20260920001"),
    ]


def test_the_date_is_the_one_written_in_the_file_whatever_the_time_zone() -> None:
    # 22h em Brasília já é o dia seguinte em UTC; a compra continua no dia 15.
    [purchase] = _summary(_statement(_transaction(posted="20260915220000[-3:BRT]")))

    assert purchase[0] == date(2026, 9, 15)


def test_reads_the_balance_informed_by_the_bank() -> None:
    statement = parse_ofx(fixture_bytes("banco_azul.ofx"))

    assert (statement.balance_cents, statement.balance_date) == (440_273, date(2026, 9, 30))


def test_reads_a_card_statement_in_xml_with_repeated_purchases_and_a_refund() -> None:
    content = fixture_bytes("cartao_verde.ofx")

    assert _summary(content) == [
        (date(2026, 9, 12), EXPENSE, 5_990, "Livraria Letras & Cia", "a1b2c3d4-0001"),
        (date(2026, 9, 18), EXPENSE, 750, "Café da Esquina", "a1b2c3d4-0002"),
        (date(2026, 9, 18), EXPENSE, 750, "Café da Esquina", "a1b2c3d4-0003"),
        (date(2026, 9, 25), INCOME, 5_990, "Estorno Livraria Letras & Cia", "a1b2c3d4-0004"),
    ]
    # A dívida do cartão vem negativa, como o saldo dele no Contaí.
    statement = parse_ofx(content)
    assert (statement.balance_cents, statement.balance_date) == (-1_500, date(2026, 10, 2))


def test_reads_a_file_out_of_the_standard_after_the_preprocessing() -> None:
    # Sem cabeçalho, marcas em minúsculas, datas com barra e com traço, valor com vírgula e
    # ponto de milhar, um lançamento sem FITID e um de valor zero.
    content = fixture_bytes("banco_laranja_fora_do_padrao.ofx")

    assert _summary(content) == [
        (date(2026, 9, 3), EXPENSE, 125_000, "ALUGUEL IMOBILIÁRIA CENTRAL", "N1001"),
        (date(2026, 9, 7), INCOME, 35_000, "PIX RECEBIDO MARINA D", None),
        (date(2026, 9, 11), EXPENSE, 3_240, "FARMÁCIA POPULAR 24H", "N1003"),
    ]
    statement = parse_ofx(content)
    assert (statement.balance_cents, statement.balance_date) == (None, None)


async def test_extract_reads_the_stored_file() -> None:
    proposed = await read_with(importer, fixture_bytes("banco_azul.ofx"))

    assert len(proposed) == 5


def test_a_balance_that_cannot_be_read_is_left_out() -> None:
    content = _statement(_transaction(), tail="<LEDGERBAL><BALAMT>abc<DTASOF>20260930</LEDGERBAL>")

    assert parse_ofx(content).balance_cents is None


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"OFXHEADER:100\nisto nao tem corpo", UNREADABLE),
        (b"<OFX><STMTTRN><MEMO>marca <quebrada</STMTTRN></OFX>", UNREADABLE),
        (b"\x00\x01\x02<OFX>", UNREADABLE),
        (_statement(""), NO_TRANSACTIONS),
    ],
    ids=["sem corpo", "marcação quebrada", "binário", "sem lançamentos"],
)
def test_a_file_that_cannot_be_imported_fails_with_a_code(content: bytes, code: str) -> None:
    with pytest.raises(ImportFailed) as failure:
        importer.normalize(parse_ofx(content), CONTEXT)

    assert failure.value.code == code


def test_a_file_with_the_statements_of_two_accounts_is_refused() -> None:
    # As transações entram em uma conta só: um arquivo com duas misturaria tudo.
    one = "<STMTRS><BANKTRANLIST>{}</BANKTRANLIST></STMTRS>"
    content = (
        "<OFX><BANKMSGSRSV1>"
        f"<STMTTRNRS>{one.format(_transaction())}</STMTTRNRS>"
        f"<STMTTRNRS>{one.format(_transaction(fitid='F2'))}</STMTTRNRS>"
        "</BANKMSGSRSV1></OFX>"
    ).encode()

    with pytest.raises(ImportFailed) as failure:
        parse_ofx(content)

    assert failure.value.code == MULTIPLE_ACCOUNTS


@pytest.mark.parametrize(
    "transaction",
    [_transaction(posted="31/02/2026"), _transaction(posted="ontem"), _transaction(amount="dez")],
    ids=["dia que não existe", "data sem números", "valor sem números"],
)
def test_a_transaction_that_cannot_be_read_fails_the_whole_file(transaction: str) -> None:
    # Importar o resto deixaria o extrato incompleto sem o usuário saber.
    with pytest.raises(ImportFailed) as failure:
        importer.normalize(parse_ofx(_statement(transaction)), CONTEXT)

    assert failure.value.code == UNREADABLE


def test_a_file_with_only_zero_amounts_has_no_transactions() -> None:
    with pytest.raises(ImportFailed) as failure:
        importer.normalize(parse_ofx(_statement(_transaction(amount="0.00"))), CONTEXT)

    assert failure.value.code == NO_TRANSACTIONS


def test_detects_ofx_by_the_content_and_not_by_the_name() -> None:
    assert importer.detect(fixture_bytes("banco_azul.ofx")[:500], "extrato.txt")
    assert importer.detect(b"<ofx><signonmsgsrsv1>", "extrato.csv")
    assert not importer.detect(b"Data;Valor\n01/09/2026;10,00", "extrato.ofx")
    assert not importer.detect(b"\x89PNG\r\n\x1a\n\x00\x00", "extrato.ofx")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("20260915", date(2026, 9, 15)),
        ("20260915220000[-3:BRT]", date(2026, 9, 15)),
        ("20260915120000.000[-3:GMT]", date(2026, 9, 15)),
        ("2026-09-15", date(2026, 9, 15)),
        ("15/09/2026", date(2026, 9, 15)),
        ("20261345", None),
        ("", None),
    ],
)
def test_parse_date(text: str, expected: date | None) -> None:
    assert parse_date(text) == expected


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("-45.90", -4_590),
        ("-45,90", -4_590),
        ("1500", 150_000),
        ("+1500.00", 150_000),
        ("-1.250,00", -125_000),
        ("1,250.00", 125_000),
        (" 0.005 ", 1),
        ("abc", None),
        ("", None),
    ],
)
def test_parse_amount(text: str, cents: int | None) -> None:
    assert parse_amount(text) == cents
