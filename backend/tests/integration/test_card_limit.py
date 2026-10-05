"""Uso do limite de um cartão de crédito (FR-088).

O limite é um teto, e não dinheiro: nunca entra no saldo, na fatura nem no que falta pagar. O
usado é o que se deve hoje mais o que já está lançado no cartão para depois de hoje, e o
disponível é o limite menos o usado.

Hoje é 1º de outubro de 2026. O cartão fecha no dia 3 e vence no dia 10: a fatura atual vai de
3 de setembro a 2 de outubro.
"""

from datetime import UTC, datetime
from typing import Any

import pytest_asyncio
from httpx import AsyncClient

from app.core import clock
from tests.finance import (
    ACCOUNTS,
    TRANSACTIONS,
    create_account,
    create_category,
    create_transaction,
)

Json = dict[str, Any]

CARDS = "/api/v1/dashboard/cards"
LIMIT = 50_000


@pytest_asyncio.fixture
async def card(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a,
        name="Inter crédito",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_date="2026-01-01",
        credit_limit_cents=LIMIT,
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
async def shopping(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Compras", icon="shopping-bag")


@pytest_asyncio.fixture
async def refund(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Estorno", kind="income", color="mata")


async def _installments(
    client: AsyncClient, card: Json, category: Json, *, total_cents: int, count: int, date: str
) -> None:
    response = await client.post(
        f"{TRANSACTIONS}/installments",
        json={
            "total_cents": total_cents,
            "installments": count,
            "date": date,
            "description": "Compra parcelada",
            "account_id": card["id"],
            "category_id": category["id"],
        },
    )
    assert response.status_code == 201, response.text


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


async def _summary(client: AsyncClient, card: Json, **params: str) -> Json:
    response = await client.get(CARDS, params=params)
    assert response.status_code == 200, response.text
    [summary] = [item for item in response.json()["items"] if item["account_id"] == card["id"]]
    return summary


async def _usage(client: AsyncClient, card: Json) -> Json | None:
    usage: Json | None = (await _summary(client, card))["credit_limit"]
    return usage


def _limit(used: int) -> Json:
    return {"limit_cents": LIMIT, "used_cents": used, "available_cents": LIMIT - used}


async def test_a_card_without_purchases_has_the_whole_limit_available(
    client_a: AsyncClient, card: Json
) -> None:
    assert await _usage(client_a, card) == _limit(0)


async def test_a_card_without_a_limit_has_no_usage(
    client_a: AsyncClient, frozen_time: datetime, shopping: Json
) -> None:
    card = await create_account(
        client_a, name="Cartão sem limite", type="credit_card", closing_day=3, due_day=10
    )
    await create_transaction(client_a, card, shopping, amount_cents=11_000, date="2026-10-01")

    assert await _usage(client_a, card) is None
    invoices = (await client_a.get(f"{CARDS}/{card['id']}/invoices")).json()
    assert invoices["credit_limit"] is None


async def test_a_purchase_uses_the_limit_and_the_limit_never_becomes_money(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    # O caso que deu origem ao campo: limite de R$ 500,00 e uma compra de R$ 110,00.
    await create_transaction(client_a, card, shopping, amount_cents=11_000, date="2026-09-20")

    summary = await _summary(client_a, card)

    assert summary["credit_limit"] == {
        "limit_cents": 50_000,
        "used_cents": 11_000,
        "available_cents": 39_000,
    }
    # O limite não entra na fatura, no que se deve nem no saldo da conta.
    assert summary["current_invoice"]["amount_cents"] == 11_000
    assert summary["payment"] == {"closed_invoice": None, "total_due_cents": 11_000}
    account = (await client_a.get(f"{ACCOUNTS}/{card['id']}")).json()
    assert (account["balance_cents"], account["credit_limit_cents"]) == (-11_000, 50_000)


async def test_the_payment_does_not_change_with_the_limit(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=30_000, date="2026-08-20")
    await create_transaction(client_a, card, shopping, amount_cents=11_000, date="2026-09-20")
    with_limit = (await _summary(client_a, card))["payment"]

    cleared = await client_a.patch(f"{ACCOUNTS}/{card['id']}", json={"credit_limit_cents": None})
    without_limit = await _summary(client_a, card)

    assert cleared.status_code == 200, cleared.text
    assert without_limit["credit_limit"] is None
    assert without_limit["payment"] == with_limit
    assert with_limit["closed_invoice"]["amount_cents"] == 30_000


async def test_an_installment_purchase_takes_its_whole_amount_from_the_limit(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    # Seis parcelas de R$ 100,00, a primeira em 20 de setembro: só ela já pesa no saldo.
    await _installments(client_a, card, shopping, total_cents=60_000, count=6, date="2026-09-20")

    summary = await _summary(client_a, card)

    assert summary["payment"]["total_due_cents"] == 10_000
    assert summary["future_installments"]["total_cents"] == 50_000
    # Passou do limite: nada é recusado, e o disponível fica negativo.
    assert summary["credit_limit"] == {
        "limit_cents": 50_000,
        "used_cents": 60_000,
        "available_cents": -10_000,
    }


async def test_an_installment_of_the_current_invoice_that_has_not_come_yet_counts_as_used(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    # Em 25 de setembro, as parcelas de 28 de agosto, 28 de setembro e 28 de outubro: a de
    # setembro está na fatura atual, mas ainda não chegou.
    clock.set_fixed_time(datetime(2026, 9, 25, 15, 0, tzinfo=UTC))
    await _installments(client_a, card, shopping, total_cents=30_000, count=3, date="2026-08-28")

    summary = await _summary(client_a, card)

    # Ela não está no que se deve hoje nem nas parcelas das faturas seguintes...
    assert summary["payment"]["total_due_cents"] == 10_000
    assert summary["future_installments"]["total_cents"] == 10_000
    # ...mas já ocupa o limite.
    assert summary["credit_limit"] == _limit(30_000)


async def test_a_purchase_with_a_future_date_counts_as_used(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=7_000, date="2026-12-15")

    summary = await _summary(client_a, card)

    assert summary["payment"]["total_due_cents"] == 0
    assert summary["credit_limit"] == _limit(7_000)


async def test_a_refund_gives_the_limit_back(
    client_a: AsyncClient, card: Json, shopping: Json, refund: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=11_000, date="2026-09-20")
    await create_transaction(client_a, card, refund, amount_cents=4_000, date="2026-09-25")
    # Um estorno com data futura abate o que está por vir.
    await create_transaction(client_a, card, shopping, amount_cents=9_000, date="2026-10-20")
    await create_transaction(client_a, card, refund, amount_cents=2_000, date="2026-10-25")

    assert await _usage(client_a, card) == _limit(11_000 - 4_000 + 9_000 - 2_000)


async def test_paying_frees_the_limit(
    client_a: AsyncClient, card: Json, checking: Json, shopping: Json
) -> None:
    await _installments(client_a, card, shopping, total_cents=30_000, count=3, date="2026-09-20")
    assert await _usage(client_a, card) == _limit(30_000)

    # Dá para pagar antes do fechamento: o que se deve hoje é a primeira parcela.
    await _pay(client_a, checking, card, 10_000, "2026-10-01")

    summary = await _summary(client_a, card)
    assert summary["payment"] == {"closed_invoice": None, "total_due_cents": 0}
    assert summary["credit_limit"] == _limit(20_000)


async def test_a_balance_in_favour_lowers_what_is_to_come_and_the_usage_never_goes_negative(
    client_a: AsyncClient, card: Json, checking: Json, shopping: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=11_000, date="2026-09-20")
    # R$ 40,00 pagos a mais: o cartão fica com saldo a favor.
    await _pay(client_a, checking, card, 15_000, "2026-09-30")

    assert await _usage(client_a, card) == _limit(0)

    await create_transaction(client_a, card, shopping, amount_cents=10_000, date="2026-10-20")

    assert await _usage(client_a, card) == _limit(6_000)


async def test_the_debt_the_card_already_had_counts_as_used(
    client_a: AsyncClient, frozen_time: datetime, shopping: Json
) -> None:
    card = await create_account(
        client_a,
        name="Cartão antigo",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-20_000,
        initial_balance_date="2026-09-15",
        credit_limit_cents=LIMIT,
    )
    # Compra anterior à data da dívida inicial: já está nela, e não conta de novo.
    await create_transaction(client_a, card, shopping, amount_cents=999, date="2026-09-10")
    await create_transaction(client_a, card, shopping, amount_cents=5_000, date="2026-09-20")

    assert await _usage(client_a, card) == _limit(25_000)


async def test_the_usage_is_seen_from_today_whatever_the_month(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await _installments(client_a, card, shopping, total_cents=30_000, count=3, date="2026-09-20")

    july = await _summary(client_a, card, month="2026-07")

    assert july["credit_limit"] == await _usage(client_a, card) == _limit(30_000)


async def test_the_invoices_of_a_card_bring_the_same_usage(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await _installments(client_a, card, shopping, total_cents=30_000, count=3, date="2026-09-20")

    response = await client_a.get(f"{CARDS}/{card['id']}/invoices")

    assert response.status_code == 200, response.text
    assert response.json()["credit_limit"] == await _usage(client_a, card) == _limit(30_000)
