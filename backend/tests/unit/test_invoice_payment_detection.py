"""Detecção de pagamento de fatura na importação (FR-081)."""

import uuid

import pytest

from app.modules.imports.detection import (
    INVOICE_PAYMENT_TERMS,
    CardInvoice,
    is_invoice_payment,
    suggest_card,
)
from app.modules.transactions.models import TransactionType
from app.modules.transactions.normalize import normalize_description

EXPENSE, INCOME = TransactionType.EXPENSE, TransactionType.INCOME

NUBANK, INTER = uuid.uuid4(), uuid.uuid4()


def _detected(description: str, kind: TransactionType = EXPENSE) -> bool:
    return is_invoice_payment(kind, normalize_description(description))


def test_the_terms_are_the_ones_of_the_requirement() -> None:
    assert INVOICE_PAYMENT_TERMS == (
        "pagamento fatura",
        "pag fatura",
        "pgto fatura",
        "pagto cartao",
        "fatura cartao",
    )


@pytest.mark.parametrize(
    "description",
    [
        "PAGAMENTO FATURA CARTÃO",
        "Pagamento Fatura",
        "PAG FATURA NUBANK",
        "PGTO FATURA 09/2026",
        "PAGTO CARTÃO DE CRÉDITO",
        "PAGTO. CARTAO 1234",
        "DÉB. AUT. FATURA CARTÃO VERDE",
        "Pagamento de fatura cartão Inter",
        "INT PAG FATURA*1234 15/09",
    ],
)
def test_an_outflow_with_one_of_the_terms_is_an_invoice_payment(description: str) -> None:
    # A comparação é com a descrição normalizada: sem maiúsculas, acentos, pontuação e números.
    assert _detected(description)


@pytest.mark.parametrize(
    "description",
    [
        "PADARIA SÃO JOÃO",
        "PAGAMENTO DE BOLETO",
        "PAGAMENTO CONTA DE LUZ",
        "FATURA DE ENERGIA",
        "CARTÃO DE VISITA GRÁFICA",
        "",
    ],
)
def test_other_outflows_are_not_invoice_payments(description: str) -> None:
    assert not _detected(description)


def test_an_inflow_is_never_an_invoice_payment() -> None:
    # No extrato do cartão, o pagamento recebido é uma entrada: não vira sugestão.
    assert not _detected("PAGAMENTO FATURA CARTÃO", INCOME)
    assert not is_invoice_payment(TransactionType.TRANSFER, "pagamento fatura")


def test_without_a_card_nothing_is_suggested() -> None:
    assert suggest_card(80_000, []) is None


def test_with_one_card_it_is_the_suggestion_whatever_its_invoice() -> None:
    assert suggest_card(80_000, [CardInvoice(NUBANK, 0)]) == NUBANK


@pytest.mark.parametrize(
    ("amount_cents", "expected"),
    [(80_000, NUBANK), (79_000, NUBANK), (31_000, INTER), (30_000, INTER), (1, INTER)],
)
def test_with_more_cards_the_closest_open_invoice_wins(
    amount_cents: int, expected: uuid.UUID
) -> None:
    cards = [CardInvoice(NUBANK, 80_000), CardInvoice(INTER, 30_000)]

    assert suggest_card(amount_cents, cards) == expected


def test_a_tie_goes_to_the_first_card_informed() -> None:
    cards = [CardInvoice(INTER, 60_000), CardInvoice(NUBANK, 40_000)]

    assert suggest_card(50_000, cards) == INTER
