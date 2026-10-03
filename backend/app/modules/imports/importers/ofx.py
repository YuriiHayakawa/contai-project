"""Importador de OFX (research.md, seção 11).

Arquivos OFX de bancos brasileiros costumam fugir do padrão: vêm sem cabeçalho, com data em
outro formato, valor com vírgula, lançamento sem identificador ou extrato sem saldo. Por isso só
o leitor de marcação do `ofxtools` é usado; a validação estrita dele recusaria esses arquivos. A
tolerância fica toda aqui: o pré-processamento prepara o texto, e os campos são lidos da árvore.
"""

import asyncio
import datetime as dt
import html
import logging
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import Element

from ofxtools.Parser import TreeBuilder

from app.core.money import decimal_to_cents
from app.modules.imports.importers.base import (
    MULTIPLE_ACCOUNTS,
    NO_TRANSACTIONS,
    UNREADABLE,
    ImportContext,
    ImportFailed,
    ProposedTransaction,
    RawDocument,
    clean_description,
)
from app.modules.imports.models import ImportFormat
from app.modules.imports.storage import StoredFile, decode_text, looks_like_ofx
from app.modules.transactions.models import TransactionType

# Em nível de depuração o `ofxtools` registra o texto de cada campo, e o conteúdo de um
# extrato nunca vai para os logs.
logging.getLogger("ofxtools").setLevel(logging.WARNING)

# Extrato de conta e fatura de cartão.
_STATEMENT_TAGS = ("STMTRS", "CCSTMTRS")
_TAG = re.compile(r"<(/?)([A-Za-z0-9_.]+)>")
_BODY_START = re.compile(r"<OFX>", re.IGNORECASE)
_COMPACT_DATE = re.compile(r"(\d{4})(\d{2})(\d{2})")
_ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_BRAZILIAN_DATE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


@dataclass(frozen=True)
class OfxRow:
    """Um `STMTTRN` como está no arquivo."""

    fitid: str
    posted: str
    amount: str
    name: str
    memo: str


def _text(element: Element, tag: str) -> str:
    # Em OFX 2 (XML) o texto vem com entidades, como `&amp;`.
    return html.unescape(element.findtext(tag) or "").strip()


def parse_date(value: str) -> dt.date | None:
    """A data como está escrita, sem a hora e o fuso.

    `20260915220000[-3:BRT]` é 15 de setembro: converter para UTC mudaria o dia.
    """
    text = value.strip()
    for pattern, order in (
        (_COMPACT_DATE, (1, 2, 3)),
        (_ISO_DATE, (1, 2, 3)),
        (_BRAZILIAN_DATE, (3, 2, 1)),
    ):
        match = pattern.match(text)
        if match is None:
            continue
        year, month, day = (int(match[index]) for index in order)
        try:
            return dt.date(year, month, day)
        except ValueError:
            return None
    return None


def parse_amount(value: str) -> int | None:
    """O valor em centavos, com sinal. Aceita `-45.90`, `-45,90` e `1.234,56`."""
    text = value.strip().replace(" ", "")
    if "," in text and "." in text:
        # O último separador é o decimal; o outro é de milhar.
        thousands = "." if text.rfind(",") > text.rfind(".") else ","
        text = text.replace(thousands, "")
    try:
        return decimal_to_cents(Decimal(text.replace(",", ".")))
    except InvalidOperation:
        return None


def _parse_tree(content: bytes) -> Element:
    text = decode_text(content)
    start = _BODY_START.search(text) if text is not None else None
    if text is None or start is None:
        raise ImportFailed(UNREADABLE)
    # O cabeçalho sai: só o corpo interessa. As marcas vão para maiúsculas, como no padrão.
    body = _TAG.sub(lambda match: f"<{match[1]}{match[2].upper()}>", text[start.start() :])
    builder = TreeBuilder()
    try:
        builder.feed(body)
        root = builder.close()
    except Exception as error:
        raise ImportFailed(UNREADABLE) from error
    if root is None:
        raise ImportFailed(UNREADABLE)
    return root


def _balance(statement: Element) -> tuple[int | None, dt.date | None]:
    """O saldo informado pelo banco (`LEDGERBAL`), quando vem com valor e data legíveis."""
    ledger = statement.find("LEDGERBAL")
    if ledger is None:
        return None, None
    amount = parse_amount(_text(ledger, "BALAMT"))
    date = parse_date(_text(ledger, "DTASOF"))
    if amount is None or date is None:
        return None, None
    return amount, date


def parse_ofx(content: bytes) -> RawDocument[OfxRow]:
    """Lê os lançamentos e o saldo de um arquivo OFX."""
    root = _parse_tree(content)
    statements = [
        element
        for element in root.iter()
        if element.tag in _STATEMENT_TAGS and element.find(".//STMTTRN") is not None
    ]
    if not statements and root.find(".//STMTTRN") is not None:
        # Lançamentos soltos, fora de um extrato: valem como um extrato só.
        statements = [root]
    if not statements:
        raise ImportFailed(NO_TRANSACTIONS)
    if len(statements) > 1:
        # As transações entram em uma conta só: um arquivo com várias misturaria tudo.
        raise ImportFailed(MULTIPLE_ACCOUNTS)

    [statement] = statements
    rows = [
        OfxRow(
            fitid=_text(transaction, "FITID"),
            posted=_text(transaction, "DTPOSTED"),
            amount=_text(transaction, "TRNAMT"),
            name=_text(transaction, "NAME"),
            memo=_text(transaction, "MEMO"),
        )
        for transaction in statement.iter("STMTTRN")
    ]
    balance_cents, balance_date = _balance(statement)
    return RawDocument(rows=rows, balance_cents=balance_cents, balance_date=balance_date)


class OfxImporter:
    formats = frozenset({ImportFormat.OFX})

    def detect(self, head: bytes, filename: str) -> bool:
        text = decode_text(head)
        return text is not None and looks_like_ofx(text)

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument[OfxRow]:
        return await asyncio.to_thread(parse_ofx, await file.read())

    def normalize(
        self, raw: RawDocument[OfxRow], context: ImportContext
    ) -> list[ProposedTransaction]:
        proposed: list[ProposedTransaction] = []
        for row in raw.rows:
            date = parse_date(row.posted)
            amount = parse_amount(row.amount)
            if date is None or amount is None:
                # Um lançamento ilegível em arquivo gerado por banco é sinal de arquivo
                # corrompido: importar o resto deixaria o extrato incompleto sem aviso.
                raise ImportFailed(UNREADABLE)
            if amount == 0:
                continue
            proposed.append(
                ProposedTransaction(
                    # O sinal do valor diz o tipo: o que sai da conta vem negativo.
                    type=TransactionType.EXPENSE if amount < 0 else TransactionType.INCOME,
                    amount_cents=abs(amount),
                    date=date,
                    description=clean_description(row.name, row.memo),
                    external_id=row.fitid or None,
                )
            )
        if not proposed:
            raise ImportFailed(NO_TRANSACTIONS)
        return proposed
