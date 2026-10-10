"""Faturas de um cartão, para a tela dele (FR-086).

Cada fatura traz o estado de hoje: paga, a pagar, vencida, aberta ou futura. Os pagamentos
quitam primeiro as faturas mais antigas, e a lista de lançamentos de uma fatura mostra só as
compras e os estornos, sem os pagamentos.

Hoje é 1º de outubro de 2026. O cartão fecha no dia 3 e vence no dia 10: a fatura atual vai de
3 de setembro a 2 de outubro, e a última fechada, de 3 de agosto a 2 de setembro, venceu em
10 de setembro.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.core import clock
from tests.finance import (
    TRANSACTIONS,
    create_account,
    create_category,
    create_transaction,
    list_transactions,
)

Json = dict[str, Any]

CARDS = "/api/v1/dashboard/cards"


def _invoices_url(card: Json) -> str:
    return f"{CARDS}/{card['id']}/invoices"


def _categories_url(card: Json, month: str) -> str:
    return f"{_invoices_url(card)}/{month}/categories"


@pytest_asyncio.fixture
async def card(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a,
        name="Cartão Nubank",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_date="2026-01-01",
    )


@pytest_asyncio.fixture
async def checking(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a,
        name="Conta corrente",
        initial_balance_cents=500_000,
        initial_balance_date="2026-01-01",
    )


@pytest_asyncio.fixture
async def food(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Alimentação")


@pytest_asyncio.fixture
async def market(client_a: AsyncClient, food: Json) -> Json:
    return await create_category(client_a, name="Mercado", parent_id=food["id"])


@pytest_asyncio.fixture
async def transport(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Transporte", icon="car", color="tinta")


@pytest_asyncio.fixture
async def refund(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Estorno", kind="income", color="mata")


async def _pay(client: AsyncClient, source: Json, card: Json, amount_cents: int, date: str) -> None:
    response = await client.post(
        f"{TRANSACTIONS}/transfers",
        json={
            "from_account_id": source["id"],
            "to_account_id": card["id"],
            "amount_cents": amount_cents,
            "date": date,
            "description": "Pagamento da fatura",
        },
    )
    assert response.status_code == 201, response.text


async def _invoices(client: AsyncClient, card: Json) -> Json:
    response = await client.get(_invoices_url(card))
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def _by_closing(body: Json) -> dict[str, Json]:
    return {item["closing_date"]: item for item in body["items"]}


async def test_invoices_go_from_the_first_with_a_purchase_to_the_last_with_an_installment(
    client_a: AsyncClient, card: Json, checking: Json, food: Json, refund: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=5_000, date="2026-07-15")
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")
    await create_transaction(client_a, card, food, amount_cents=10_000, date="2026-09-20")
    await create_transaction(client_a, card, refund, amount_cents=1_000, date="2026-09-25")
    # Parcelas em 20 de setembro, de outubro e de novembro.
    response = await client_a.post(
        f"{TRANSACTIONS}/installments",
        json={
            "total_cents": 90_000,
            "installments": 3,
            "date": "2026-09-20",
            "description": "Geladeira",
            "account_id": card["id"],
            "category_id": food["id"],
        },
    )
    assert response.status_code == 201, response.text
    # Paga a fatura que fechou em agosto; a compra na conta corrente não é do cartão.
    await _pay(client_a, checking, card, 5_000, "2026-08-08")
    await create_transaction(client_a, checking, food, amount_cents=7_777, date="2026-08-20")

    body = await _invoices(client_a, card)

    assert {key: body[key] for key in ("account_id", "name", "closing_day", "due_day")} == {
        "account_id": card["id"],
        "name": "Cartão Nubank",
        "closing_day": 3,
        "due_day": 10,
    }
    assert body["items"] == [
        {
            "period_start": "2026-07-03",
            "period_end": "2026-08-02",
            "closing_date": "2026-08-03",
            "due_date": "2026-08-10",
            "amount_cents": 5_000,
            "status": "paid",
            "remaining_cents": 0,
        },
        {
            "period_start": "2026-08-03",
            "period_end": "2026-09-02",
            "closing_date": "2026-09-03",
            "due_date": "2026-09-10",
            "amount_cents": 30_000,
            "status": "overdue",
            "remaining_cents": 30_000,
        },
        {
            "period_start": "2026-09-03",
            "period_end": "2026-10-02",
            "closing_date": "2026-10-03",
            "due_date": "2026-10-10",
            # A compra e a primeira parcela, menos o estorno. O pagamento não entra.
            "amount_cents": 10_000 + 30_000 - 1_000,
            "status": "open",
            "remaining_cents": 0,
        },
        {
            "period_start": "2026-10-03",
            "period_end": "2026-11-02",
            "closing_date": "2026-11-03",
            "due_date": "2026-11-10",
            "amount_cents": 30_000,
            "status": "future",
            "remaining_cents": 0,
        },
        {
            "period_start": "2026-11-03",
            "period_end": "2026-12-02",
            "closing_date": "2026-12-03",
            "due_date": "2026-12-10",
            "amount_cents": 30_000,
            "status": "future",
            "remaining_cents": 0,
        },
    ]
    assert body["payment"] == {
        "closed_invoice": {
            "closing_date": "2026-09-03",
            "due_date": "2026-09-10",
            "amount_cents": 30_000,
        },
        "total_due_cents": 30_000 + 10_000 + 30_000 - 1_000,
    }


async def test_the_payment_shown_is_the_same_of_the_panel(
    client_a: AsyncClient, card: Json, checking: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")
    await _pay(client_a, checking, card, 12_000, "2026-09-08")

    body = await _invoices(client_a, card)

    panel = (await client_a.get(CARDS)).json()["items"][0]
    assert body["payment"] == panel["payment"]


async def test_a_closed_invoice_is_due_until_its_due_date_and_overdue_after_it(
    client_a: AsyncClient, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")

    clock.set_fixed_time(datetime(2026, 9, 10, 15, 0, tzinfo=UTC))
    on_the_due_date = _by_closing(await _invoices(client_a, card))["2026-09-03"]
    clock.set_fixed_time(datetime(2026, 9, 11, 15, 0, tzinfo=UTC))
    the_day_after = _by_closing(await _invoices(client_a, card))["2026-09-03"]

    assert on_the_due_date["status"] == "due"
    assert the_day_after["status"] == "overdue"
    assert on_the_due_date["remaining_cents"] == the_day_after["remaining_cents"] == 30_000


async def test_the_invoice_is_open_until_the_day_before_it_closes(
    client_a: AsyncClient, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=10_000, date="2026-09-20")

    assert _by_closing(await _invoices(client_a, card))["2026-10-03"]["status"] == "open"

    # No dia do fechamento ela já está fechada, a pagar, e a atual é a seguinte.
    clock.set_fixed_time(datetime(2026, 10, 3, 15, 0, tzinfo=UTC))
    invoices = _by_closing(await _invoices(client_a, card))
    assert invoices["2026-10-03"]["status"] == "due"
    assert invoices["2026-11-03"]["status"] == "open"


async def test_the_current_invoice_paid_in_advance_shows_as_paid_before_closing(
    client_a: AsyncClient, checking: Json, card: Json, food: Json
) -> None:
    # Uma compra na fatura atual (fecha 3 de outubro) e o pagamento dela por completo.
    await create_transaction(client_a, card, food, amount_cents=11_000, date="2026-09-20")
    assert _by_closing(await _invoices(client_a, card))["2026-10-03"]["status"] == "open"

    await _pay(client_a, checking, card, 11_000, "2026-10-01")

    paid = _by_closing(await _invoices(client_a, card))["2026-10-03"]
    # Fica paga antes de fechar, mas continua sendo a fatura atual.
    assert (paid["status"], paid["amount_cents"]) == ("paid_ahead", 11_000)
    # O painel também vê a fatura atual como paga.
    summary = (await client_a.get(CARDS)).json()["items"][0]
    assert summary["current_invoice_paid"] is True
    assert summary["payment"] == {"closed_invoice": None, "total_due_cents": 0}


async def test_a_new_purchase_reopens_the_current_invoice(
    client_a: AsyncClient, checking: Json, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=11_000, date="2026-09-20")
    await _pay(client_a, checking, card, 11_000, "2026-10-01")
    assert _by_closing(await _invoices(client_a, card))["2026-10-03"]["status"] == "paid_ahead"

    await create_transaction(client_a, card, food, amount_cents=5_000, date="2026-10-01")

    reopened = _by_closing(await _invoices(client_a, card))["2026-10-03"]
    assert (reopened["status"], reopened["amount_cents"]) == ("open", 16_000)
    assert (await client_a.get(CARDS)).json()["items"][0]["current_invoice_paid"] is False


async def test_the_current_invoice_paid_only_in_part_stays_open(
    client_a: AsyncClient, checking: Json, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=11_000, date="2026-09-20")
    await _pay(client_a, checking, card, 6_000, "2026-10-01")

    current = _by_closing(await _invoices(client_a, card))["2026-10-03"]

    # Pago em parte: continua aberta, e o painel não a dá como paga.
    assert current["status"] == "open"
    assert (await client_a.get(CARDS)).json()["items"][0]["current_invoice_paid"] is False


async def test_an_overpaid_current_invoice_is_paid_and_the_credit_abates_what_comes(
    client_a: AsyncClient, checking: Json, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=11_000, date="2026-09-20")
    # Paga R$ 40,00 a mais: a fatura fica paga, e o crédito abate o que vier.
    await _pay(client_a, checking, card, 15_000, "2026-10-01")

    assert _by_closing(await _invoices(client_a, card))["2026-10-03"]["status"] == "paid_ahead"
    assert (await client_a.get(CARDS)).json()["items"][0]["current_invoice_paid"] is True


async def test_the_current_invoice_without_charges_is_not_paid_ahead(
    client_a: AsyncClient, checking: Json, card: Json
) -> None:
    # Sem compra na fatura atual, um pagamento (que vira crédito) não a deixa "paga".
    await _pay(client_a, checking, card, 5_000, "2026-10-01")

    assert _by_closing(await _invoices(client_a, card))["2026-10-03"]["status"] == "open"
    assert (await client_a.get(CARDS)).json()["items"][0]["current_invoice_paid"] is False


async def test_a_past_month_current_invoice_is_never_paid_ahead(
    client_a: AsyncClient, checking: Json, card: Json, food: Json
) -> None:
    # A fatura atual está paga hoje, mas num mês que passou a fatura mostrada é outra.
    await create_transaction(client_a, card, food, amount_cents=11_000, date="2026-09-20")
    await _pay(client_a, checking, card, 11_000, "2026-10-01")

    july = (await client_a.get(CARDS, params={"month": "2026-07"})).json()["items"][0]

    assert july["current_invoice_paid"] is False


async def test_a_paid_invoice_has_nothing_left(
    client_a: AsyncClient, card: Json, checking: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")
    await _pay(client_a, checking, card, 30_000, "2026-09-08")

    body = await _invoices(client_a, card)

    closed = _by_closing(body)["2026-09-03"]
    assert (closed["status"], closed["amount_cents"], closed["remaining_cents"]) == (
        "paid",
        30_000,
        0,
    )
    assert body["payment"]["closed_invoice"] is None


async def test_a_partly_paid_invoice_shows_what_is_left_of_it(
    client_a: AsyncClient, card: Json, checking: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")
    await _pay(client_a, checking, card, 12_000, "2026-09-08")

    closed = _by_closing(await _invoices(client_a, card))["2026-09-03"]

    assert (closed["status"], closed["amount_cents"], closed["remaining_cents"]) == (
        "overdue",
        30_000,
        18_000,
    )


async def test_payments_settle_the_oldest_invoices_first(
    client_a: AsyncClient, card: Json, checking: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=5_000, date="2026-06-15")
    await create_transaction(client_a, card, food, amount_cents=8_000, date="2026-07-15")
    await create_transaction(client_a, card, food, amount_cents=30_000, date="2026-08-20")
    # Quita a de junho e parte da de julho.
    await _pay(client_a, checking, card, 7_000, "2026-09-08")

    body = await _invoices(client_a, card)

    invoices = _by_closing(body)
    assert [
        (closing, invoices[closing]["status"], invoices[closing]["remaining_cents"])
        for closing in ("2026-07-03", "2026-08-03", "2026-09-03")
    ] == [
        ("2026-07-03", "paid", 0),
        ("2026-08-03", "overdue", 6_000),
        ("2026-09-03", "overdue", 30_000),
    ]
    # O que falta de cada fatura soma o que se deve das fechadas, que é o valor do "Pagar fatura".
    assert body["payment"]["closed_invoice"]["amount_cents"] == 36_000


async def test_a_card_without_purchases_has_the_last_closed_and_the_open_invoice(
    client_a: AsyncClient, card: Json
) -> None:
    body = await _invoices(client_a, card)

    assert [
        (item["closing_date"], item["status"], item["amount_cents"]) for item in body["items"]
    ] == [("2026-09-03", "paid", 0), ("2026-10-03", "open", 0)]
    assert body["payment"] == {"closed_invoice": None, "total_due_cents": 0}


async def test_the_initial_debt_leaves_the_last_closed_invoice_to_pay(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    card = await create_account(
        client_a,
        name="Cartão Inter",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-20_000,
        initial_balance_date="2026-09-15",
    )

    body = await _invoices(client_a, card)

    # A dívida veio no saldo inicial e não está em compra nenhuma: a fatura não tem valor
    # próprio, e o que pagar está em `payment`.
    closed = _by_closing(body)["2026-09-03"]
    assert (closed["status"], closed["amount_cents"], closed["remaining_cents"]) == (
        "overdue",
        0,
        0,
    )
    assert body["payment"]["closed_invoice"]["amount_cents"] == 20_000


async def test_an_invoice_with_more_refunds_than_purchases_is_negative_and_paid(
    client_a: AsyncClient, card: Json, food: Json, refund: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=2_000, date="2026-08-10")
    await create_transaction(client_a, card, refund, amount_cents=5_000, date="2026-08-20")

    closed = _by_closing(await _invoices(client_a, card))["2026-09-03"]

    assert (closed["status"], closed["amount_cents"], closed["remaining_cents"]) == (
        "paid",
        -3_000,
        0,
    )


async def test_invoices_older_than_three_years_are_left_out(
    client_a: AsyncClient, card: Json, food: Json
) -> None:
    await create_transaction(client_a, card, food, amount_cents=1_000, date="2021-05-10")
    await create_transaction(client_a, card, food, amount_cents=2_000, date="2026-08-20")

    body = await _invoices(client_a, card)

    assert body["items"][0]["closing_date"] == "2026-09-03"


async def test_invoices_are_only_for_credit_cards_of_the_user(
    client_a: AsyncClient, card: Json, checking: Json
) -> None:
    unknown = {"id": "00000000-0000-4000-8000-000000000000"}

    for account in (checking, unknown):
        for url in (_invoices_url(account), _categories_url(account, "2026-10")):
            response = await client_a.get(url)

            assert response.status_code == 404, url
            assert response.json()["error"]["code"] == "not_found"


async def test_invoices_require_authentication(client: AsyncClient, card: Json) -> None:
    for url in (_invoices_url(card), _categories_url(card, "2026-10")):
        response = await client.get(url)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"


# ---------- para onde foi o gasto de uma fatura


async def test_invoice_categories_count_only_the_card_purchases_of_its_period(
    client_a: AsyncClient,
    card: Json,
    checking: Json,
    food: Json,
    market: Json,
    transport: Json,
    refund: Json,
) -> None:
    # A fatura que fecha em outubro: de 3 de setembro a 2 de outubro.
    await create_transaction(client_a, card, market, amount_cents=30_000, date="2026-09-03")
    await create_transaction(client_a, card, food, amount_cents=5_000, date="2026-10-01")
    await create_transaction(client_a, card, transport, amount_cents=12_000, date="2026-09-20")
    # Receita em categoria de receita não é gasto de nenhuma categoria.
    await create_transaction(client_a, card, refund, amount_cents=1_000, date="2026-09-21")
    # Fora do período, ou em outra conta.
    await create_transaction(client_a, card, food, amount_cents=999, date="2026-09-02")
    await create_transaction(client_a, card, food, amount_cents=888, date="2026-10-03")
    await create_transaction(client_a, checking, food, amount_cents=7_777, date="2026-09-20")
    await _pay(client_a, checking, card, 4_000, "2026-09-25")

    response = await client_a.get(_categories_url(card, "2026-10"))

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["month"], body["total_cents"]) == ("2026-10", 47_000)
    assert [(item["name"], item["amount_cents"], item["percent"]) for item in body["items"]] == [
        ("Alimentação", 35_000, 74.5),
        ("Transporte", 12_000, 25.5),
    ]
    assert [
        (child["name"], child["amount_cents"]) for child in body["items"][0]["subcategories"]
    ] == [("Mercado", 30_000)]


async def test_invoice_categories_of_an_invoice_without_purchases_are_empty(
    client_a: AsyncClient, card: Json
) -> None:
    response = await client_a.get(_categories_url(card, "2026-10"))

    assert response.status_code == 200, response.text
    assert response.json() == {"month": "2026-10", "total_cents": 0, "items": []}


@pytest.mark.parametrize("month", ["2026-13", "10-2026", "2026-10-03", "outubro"])
async def test_invoice_categories_refuse_a_month_in_another_format(
    client_a: AsyncClient, card: Json, month: str
) -> None:
    response = await client_a.get(_categories_url(card, month))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "AAAA-MM" in error["details"]["fields"]["month"]


# ---------- os lançamentos de uma fatura


async def test_the_list_without_transfers_shows_the_purchases_and_refunds_of_an_invoice(
    client_a: AsyncClient, card: Json, checking: Json, food: Json, refund: Json
) -> None:
    await create_transaction(
        client_a, card, food, amount_cents=10_000, date="2026-09-20", description="Mercado"
    )
    await create_transaction(
        client_a, card, refund, amount_cents=1_000, date="2026-09-25", description="Devolução"
    )
    await _pay(client_a, checking, card, 4_000, "2026-09-25")
    invoice = _by_closing(await _invoices(client_a, card))["2026-10-03"]
    period = {
        "account_id": card["id"],
        "from": invoice["period_start"],
        "to": invoice["period_end"],
    }

    everything = await list_transactions(client_a, **period)
    purchases = await list_transactions(client_a, **period, without_transfers="true")

    assert everything["total_count"] == 3
    assert purchases["total_count"] == 2
    assert [item["description"] for item in purchases["items"]] == ["Devolução", "Mercado"]
    # A soma da lista é o valor da fatura.
    assert invoice["amount_cents"] == 10_000 - 1_000
