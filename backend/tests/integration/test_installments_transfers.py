"""Compras parceladas, transferências e o resumo de cartões (FR-030 a FR-034, FR-058).

Parcelas e transferências também aparecem na lista de lançamentos; o painel conta cada parcela
no mês da sua própria data e nunca conta transferência como entrada ou saída.
"""

from datetime import datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.finance import (
    ACCOUNTS,
    TRANSACTIONS,
    balance_of,
    create_account,
    create_category,
    create_transaction,
    list_transactions,
)

Json = dict[str, Any]

INSTALLMENTS = f"{TRANSACTIONS}/installments"
TRANSFERS = f"{TRANSACTIONS}/transfers"
SUMMARY = "/api/v1/dashboard/summary"
CARDS = "/api/v1/dashboard/cards"


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
async def savings(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a, name="Poupança", type="savings", initial_balance_date="2026-01-01"
    )


@pytest_asyncio.fixture
async def shopping(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Compras", icon="shopping-bag")


@pytest_asyncio.fixture
async def refund(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Estorno", kind="income", color="mata")


async def _installments(
    client: AsyncClient, card: Json, category: Json, **fields: object
) -> list[Json]:
    payload = {
        "total_cents": 10_000,
        "installments": 3,
        "date": "2026-09-20",
        "description": "Tênis de corrida",
        "account_id": card["id"],
        "category_id": category["id"],
        **fields,
    }
    response = await client.post(INSTALLMENTS, json=payload)
    assert response.status_code == 201, response.text
    items: list[Json] = response.json()["items"]
    return items


async def _transfer(
    client: AsyncClient, source: Json, target: Json, **fields: object
) -> list[Json]:
    payload = {
        "from_account_id": source["id"],
        "to_account_id": target["id"],
        "amount_cents": 50_000,
        "date": "2026-09-15",
        "description": "Guardar dinheiro",
        **fields,
    }
    response = await client.post(TRANSFERS, json=payload)
    assert response.status_code == 201, response.text
    items: list[Json] = response.json()["items"]
    return items


async def _all(client: AsyncClient, **filters: object) -> list[Json]:
    page = await list_transactions(client, limit=200, **filters)
    items: list[Json] = page["items"]
    return items


async def _get(client: AsyncClient, transaction: Json) -> Json:
    response = await client.get(f"{TRANSACTIONS}/{transaction['id']}")
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def _summary(client: AsyncClient, month: str) -> Json:
    response = await client.get(SUMMARY, params={"month": month})
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def _field_errors(response: Any) -> dict[str, str]:
    assert response.status_code == 422, response.text
    fields: dict[str, str] = response.json()["error"]["details"]["fields"]
    return fields


# ---------- compra parcelada


async def test_100_reais_in_3_installments_puts_the_extra_cent_in_the_first(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    parcels = await _installments(client_a, card, shopping)

    assert [
        (p["amount_cents"], p["date"], p["installment_number"], p["installment_count"])
        for p in parcels
    ] == [
        (3_334, "2026-09-20", 1, 3),
        (3_333, "2026-10-20", 2, 3),
        (3_333, "2026-11-20", 3, 3),
    ]
    assert sum(p["amount_cents"] for p in parcels) == 10_000
    assert len({p["installment_group_id"] for p in parcels}) == 1
    assert {(p["type"], p["account_id"], p["category_id"]) for p in parcels} == {
        ("expense", card["id"], shopping["id"])
    }
    listed = await _all(client_a, installment_group_id=parcels[0]["installment_group_id"])
    assert sorted(item["id"] for item in listed) == sorted(p["id"] for p in parcels)


@pytest.mark.parametrize(
    ("total", "count"),
    [(10_000, 7), (99_999, 48), (1_001, 2), (48, 48), (12_345_678, 13)],
)
async def test_installments_always_add_up_to_the_total(
    client_a: AsyncClient, card: Json, shopping: Json, total: int, count: int
) -> None:
    parcels = await _installments(client_a, card, shopping, total_cents=total, installments=count)

    amounts = [p["amount_cents"] for p in parcels]
    assert sum(amounts) == total
    assert len(amounts) == count
    assert amounts[1:] == [total // count] * (count - 1)
    assert amounts[0] == total // count + total % count


async def test_an_installment_on_a_missing_day_falls_on_the_last_day_of_the_month(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    from_january_31 = await _installments(
        client_a, card, shopping, date="2026-01-31", installments=4
    )
    leap_year = await _installments(client_a, card, shopping, date="2028-01-30", installments=2)

    # Cada parcela é contada a partir da data da compra: depois de fevereiro, o dia 31 volta.
    assert [p["date"] for p in from_january_31] == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
    ]
    assert [p["date"] for p in leap_year] == ["2028-01-30", "2028-02-29"]


async def test_installments_are_only_for_credit_cards(
    client_a: AsyncClient, checking: Json, shopping: Json
) -> None:
    response = await client_a.post(
        INSTALLMENTS,
        json={
            "total_cents": 10_000,
            "installments": 3,
            "date": "2026-09-20",
            "description": "Tênis",
            "account_id": checking["id"],
            "category_id": shopping["id"],
        },
    )

    assert "account_id" in _field_errors(response)
    assert await _all(client_a) == []


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"installments": 1}, "installments"),
        ({"installments": 49}, "installments"),
        ({"total_cents": 0}, "total_cents"),
        # Cada parcela precisa de pelo menos um centavo.
        ({"total_cents": 2, "installments": 3}, "total_cents"),
    ],
)
async def test_installment_count_and_total_are_validated(
    client_a: AsyncClient, card: Json, shopping: Json, changes: Json, field: str
) -> None:
    payload = {
        "total_cents": 10_000,
        "installments": 3,
        "date": "2026-09-20",
        "description": "Tênis",
        "account_id": card["id"],
        "category_id": shopping["id"],
        **changes,
    }

    response = await client_a.post(INSTALLMENTS, json=payload)

    assert field in _field_errors(response)
    assert await _all(client_a) == []


async def test_installments_need_an_expense_category_and_an_active_card(
    client_a: AsyncClient, card: Json, shopping: Json, refund: Json
) -> None:
    income_category = await client_a.post(
        INSTALLMENTS,
        json={
            "total_cents": 10_000,
            "installments": 3,
            "date": "2026-09-20",
            "description": "Tênis",
            "account_id": card["id"],
            "category_id": refund["id"],
        },
    )
    await client_a.post(f"{ACCOUNTS}/{card['id']}/archive")
    archived_card = await client_a.post(
        INSTALLMENTS,
        json={
            "total_cents": 10_000,
            "installments": 3,
            "date": "2026-09-20",
            "description": "Tênis",
            "account_id": card["id"],
            "category_id": shopping["id"],
        },
    )

    assert "category_id" in _field_errors(income_category)
    assert "account_id" in _field_errors(archived_card)


async def test_each_installment_counts_in_the_month_of_its_own_date(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await _installments(client_a, card, shopping, total_cents=90_000, date="2026-09-28")

    months = {month: await _summary(client_a, month) for month in ("2026-09", "2026-10", "2026-11")}

    assert [months[m]["expense_cents"] for m in months] == [30_000, 30_000, 30_000]


async def test_a_card_purchase_on_september_28_counts_in_september(
    client_a: AsyncClient, frozen_time: datetime, shopping: Json
) -> None:
    # Fecha no dia 25: a compra de 28 de setembro é da fatura que fecha em outubro e vence em
    # novembro, mas é uma despesa de setembro (FR-031).
    card = await create_account(
        client_a, name="Cartão Inter", type="credit_card", closing_day=25, due_day=5
    )
    await create_transaction(client_a, card, shopping, amount_cents=12_345, date="2026-09-28")

    september = await _summary(client_a, "2026-09")
    october = await _summary(client_a, "2026-10")
    november = await _summary(client_a, "2026-11")

    assert (september["expense_cents"], october["expense_cents"], november["expense_cents"]) == (
        12_345,
        0,
        0,
    )


# ---------- editar e excluir parcelas com escopo


async def test_editing_with_scope_single_changes_only_that_installment(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    first, second, third = await _installments(client_a, card, shopping)

    response = await client_a.patch(
        f"{TRANSACTIONS}/{second['id']}",
        params={"scope": "single"},
        json={"amount_cents": 5_000, "description": "Tênis com desconto"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["amount_cents"] == 5_000
    assert (await _get(client_a, first)) == first
    assert (await _get(client_a, third)) == third
    assert (await _get(client_a, second))["description"] == "Tênis com desconto"


async def test_editing_with_scope_following_changes_this_and_the_next_but_not_the_previous(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    parcels = await _installments(client_a, card, shopping, total_cents=40_000, installments=4)
    other = await create_category(client_a, name="Esporte", icon="dumbbell", color="mata")

    response = await client_a.patch(
        f"{TRANSACTIONS}/{parcels[1]['id']}",
        params={"scope": "following"},
        json={
            "amount_cents": 9_000,
            "description": "Tênis (renegociado)",
            "category_id": other["id"],
            "notes": "Valor novo a partir da 2ª",
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()["items"]
    assert [p["installment_number"] for p in updated] == [2, 3, 4]
    after = [await _get(client_a, parcel) for parcel in parcels]
    assert after[0] == parcels[0]
    assert [
        (p["amount_cents"], p["description"], p["category_id"], p["notes"], p["date"])
        for p in after[1:]
    ] == [
        (9_000, "Tênis (renegociado)", other["id"], "Valor novo a partir da 2ª", parcel["date"])
        for parcel in parcels[1:]
    ]


async def test_changing_the_date_with_scope_following_moves_the_next_installments_too(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    parcels = await _installments(client_a, card, shopping, date="2026-01-15", installments=4)

    response = await client_a.patch(
        f"{TRANSACTIONS}/{parcels[1]['id']}",
        params={"scope": "following"},
        json={"date": "2026-02-28"},
    )

    assert response.status_code == 200, response.text
    dates = [(await _get(client_a, parcel))["date"] for parcel in parcels]
    # A nova data vale para esta; as seguintes ficam um mês depois da outra, no mesmo dia.
    assert dates == ["2026-01-15", "2026-02-28", "2026-03-28", "2026-04-28"]


async def test_scope_following_on_the_first_installment_changes_all_of_them(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    parcels = await _installments(client_a, card, shopping)

    response = await client_a.patch(
        f"{TRANSACTIONS}/{parcels[0]['id']}",
        params={"scope": "following"},
        json={"description": "Tênis novo"},
    )

    assert response.status_code == 200
    assert {(await _get(client_a, p))["description"] for p in parcels} == {"Tênis novo"}


async def test_deleting_with_scope_single_keeps_the_other_installments(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    first, second, third = await _installments(client_a, card, shopping)

    response = await client_a.delete(f"{TRANSACTIONS}/{second['id']}", params={"scope": "single"})

    assert response.status_code == 204
    remaining = await _all(client_a, installment_group_id=first["installment_group_id"])
    assert sorted(item["id"] for item in remaining) == sorted([first["id"], third["id"]])


async def test_deleting_with_scope_following_removes_this_and_the_next_only(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    parcels = await _installments(client_a, card, shopping, installments=4)

    response = await client_a.delete(
        f"{TRANSACTIONS}/{parcels[2]['id']}", params={"scope": "following"}
    )

    assert response.status_code == 204
    remaining = await _all(client_a, installment_group_id=parcels[0]["installment_group_id"])
    assert sorted(item["id"] for item in remaining) == sorted(p["id"] for p in parcels[:2])


async def test_without_scope_an_installment_is_changed_alone(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    first, second, _ = await _installments(client_a, card, shopping)

    await client_a.patch(f"{TRANSACTIONS}/{first['id']}", json={"description": "Só a primeira"})
    deleted = await client_a.delete(f"{TRANSACTIONS}/{first['id']}")

    assert deleted.status_code == 204
    assert (await _get(client_a, second)) == second


async def test_scope_is_ignored_outside_an_installment_purchase(
    client_a: AsyncClient, checking: Json, shopping: Json
) -> None:
    alone = await create_transaction(client_a, checking, shopping)
    neighbour = await create_transaction(client_a, checking, shopping, description="Vizinha")

    edited = await client_a.patch(
        f"{TRANSACTIONS}/{alone['id']}", params={"scope": "following"}, json={"amount_cents": 1}
    )
    deleted = await client_a.delete(f"{TRANSACTIONS}/{alone['id']}", params={"scope": "following"})

    assert edited.status_code == 200
    assert edited.json()["amount_cents"] == 1
    assert deleted.status_code == 204
    assert (await _get(client_a, neighbour)) == neighbour


async def test_an_unknown_scope_is_refused(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    first, *_ = await _installments(client_a, card, shopping)

    response = await client_a.delete(f"{TRANSACTIONS}/{first['id']}", params={"scope": "group"})

    assert "scope" in _field_errors(response)


async def test_installments_stay_expenses_on_a_credit_card(
    client_a: AsyncClient, card: Json, checking: Json, shopping: Json, refund: Json
) -> None:
    first, *_ = await _installments(client_a, card, shopping)

    to_income = await client_a.patch(
        f"{TRANSACTIONS}/{first['id']}", json={"type": "income", "category_id": refund["id"]}
    )
    to_checking = await client_a.patch(
        f"{TRANSACTIONS}/{first['id']}",
        params={"scope": "following"},
        json={"account_id": checking["id"]},
    )

    assert "type" in _field_errors(to_income)
    assert "account_id" in _field_errors(to_checking)
    assert (await _get(client_a, first)) == first


# ---------- transferências


async def test_a_transfer_creates_two_linked_lines_and_moves_both_balances(
    client_a: AsyncClient, checking: Json, savings: Json
) -> None:
    before = (await balance_of(client_a, checking), await balance_of(client_a, savings))

    out, received = await _transfer(client_a, checking, savings, amount_cents=50_000)

    assert (out["transfer_direction"], out["account_id"]) == ("out", checking["id"])
    assert (received["transfer_direction"], received["account_id"]) == ("in", savings["id"])
    for line in (out, received):
        assert (line["type"], line["amount_cents"], line["date"], line["category_id"]) == (
            "transfer",
            50_000,
            "2026-09-15",
            None,
        )
    assert out["transfer_group_id"] == received["transfer_group_id"]
    after = (await balance_of(client_a, checking), await balance_of(client_a, savings))
    assert after == (before[0] - 50_000, before[1] + 50_000)
    # A lista acha os dois lados pelo grupo da transferência.
    pair = await _all(client_a, transfer_group_id=out["transfer_group_id"])
    assert sorted(line["id"] for line in pair) == sorted([out["id"], received["id"]])


async def test_a_transfer_never_counts_as_income_or_expense(
    client_a: AsyncClient, checking: Json, savings: Json, shopping: Json
) -> None:
    await create_transaction(client_a, checking, shopping, amount_cents=4_590, date="2026-09-15")
    before = await _summary(client_a, "2026-09")

    await _transfer(client_a, checking, savings, amount_cents=50_000)

    after = await _summary(client_a, "2026-09")
    assert (after["income_cents"], after["expense_cents"], after["net_cents"]) == (
        before["income_cents"],
        before["expense_cents"],
        before["net_cents"],
    )
    assert after["expense_cents"] == 4_590


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"to_account_id": "same"}, "to_account_id"),
        ({"amount_cents": 0}, "amount_cents"),
        ({"description": ""}, "description"),
    ],
)
async def test_transfer_input_is_validated(
    client_a: AsyncClient, checking: Json, savings: Json, changes: Json, field: str
) -> None:
    payload = {
        "from_account_id": checking["id"],
        "to_account_id": savings["id"],
        "amount_cents": 50_000,
        "date": "2026-09-15",
        "description": "Guardar",
        **changes,
    }
    if payload["to_account_id"] == "same":
        payload["to_account_id"] = checking["id"]

    response = await client_a.post(TRANSFERS, json=payload)

    assert field in _field_errors(response)
    assert await _all(client_a) == []


async def test_a_transfer_needs_two_active_accounts(
    client_a: AsyncClient, checking: Json, savings: Json
) -> None:
    await client_a.post(f"{ACCOUNTS}/{savings['id']}/archive")

    response = await client_a.post(
        TRANSFERS,
        json={
            "from_account_id": checking["id"],
            "to_account_id": savings["id"],
            "amount_cents": 1_000,
            "date": "2026-09-15",
            "description": "Guardar",
        },
    )

    assert "to_account_id" in _field_errors(response)


async def test_editing_either_side_of_a_transfer_changes_both(
    client_a: AsyncClient, checking: Json, savings: Json
) -> None:
    out, received = await _transfer(client_a, checking, savings)

    response = await client_a.patch(
        f"{TRANSACTIONS}/{received['id']}",
        json={"amount_cents": 70_000, "date": "2026-09-20", "description": "Reserva", "notes": "x"},
    )

    assert response.status_code == 200, response.text
    for line in (await _get(client_a, out), await _get(client_a, received)):
        assert (line["amount_cents"], line["date"], line["description"], line["notes"]) == (
            70_000,
            "2026-09-20",
            "Reserva",
            "x",
        )
    assert await balance_of(client_a, savings) == 70_000


async def test_moving_one_side_of_a_transfer_to_another_account(
    client_a: AsyncClient, checking: Json, savings: Json, frozen_time: datetime
) -> None:
    wallet = await create_account(
        client_a, name="Carteira", type="cash", initial_balance_date="2026-01-01"
    )
    out, received = await _transfer(client_a, checking, savings)

    moved = await client_a.patch(
        f"{TRANSACTIONS}/{received['id']}", json={"account_id": wallet["id"]}
    )
    same_as_other_side = await client_a.patch(
        f"{TRANSACTIONS}/{received['id']}", json={"account_id": checking["id"]}
    )

    assert moved.status_code == 200, moved.text
    assert (await balance_of(client_a, wallet), await balance_of(client_a, savings)) == (50_000, 0)
    assert (await _get(client_a, out))["account_id"] == checking["id"]
    assert "account_id" in _field_errors(same_as_other_side)


async def test_a_transfer_has_no_category_and_cannot_become_an_expense(
    client_a: AsyncClient, checking: Json, savings: Json, shopping: Json
) -> None:
    out, _ = await _transfer(client_a, checking, savings)

    with_category = await client_a.patch(
        f"{TRANSACTIONS}/{out['id']}", json={"category_id": shopping["id"]}
    )
    to_expense = await client_a.patch(
        f"{TRANSACTIONS}/{out['id']}", json={"type": "expense", "category_id": shopping["id"]}
    )

    assert "category_id" in _field_errors(with_category)
    assert "type" in _field_errors(to_expense)


async def test_deleting_one_side_of_a_transfer_deletes_both(
    client_a: AsyncClient, checking: Json, savings: Json
) -> None:
    before = (await balance_of(client_a, checking), await balance_of(client_a, savings))
    out, received = await _transfer(client_a, checking, savings)

    response = await client_a.delete(f"{TRANSACTIONS}/{out['id']}")

    assert response.status_code == 204
    for line in (out, received):
        assert (await client_a.get(f"{TRANSACTIONS}/{line['id']}")).status_code == 404
    assert (await balance_of(client_a, checking), await balance_of(client_a, savings)) == before


# ---------- pagamento de fatura e resumo de cartões


async def test_paying_the_card_invoice_is_a_transfer_that_leaves_the_panel_totals_alone(
    client_a: AsyncClient, checking: Json, card: Json, shopping: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=80_000, date="2026-09-10")
    summary_before = await _summary(client_a, "2026-09")
    cards_before = (await client_a.get(CARDS)).json()
    debt = await balance_of(client_a, card)

    await _transfer(
        client_a, checking, card, amount_cents=80_000, date="2026-09-30", description="Fatura"
    )

    summary_after = await _summary(client_a, "2026-09")
    assert debt == -80_000
    assert await balance_of(client_a, card) == 0
    assert await balance_of(client_a, checking) == 500_000 - 80_000
    assert {key: summary_after[key] for key in ("income_cents", "expense_cents", "net_cents")} == {
        key: summary_before[key] for key in ("income_cents", "expense_cents", "net_cents")
    }
    # Pagar a fatura não muda o valor gasto nela.
    assert (await client_a.get(CARDS)).json() == cards_before


async def test_cards_summary_shows_the_current_invoice_and_future_installments(
    client_a: AsyncClient, card: Json, checking: Json, shopping: Json, refund: Json
) -> None:
    # Hoje é 1º de outubro; o cartão fecha no dia 3 e vence no dia 10. A fatura atual reúne as
    # compras de 3 de setembro a 2 de outubro.
    await _installments(client_a, card, shopping, total_cents=120_000, date="2026-09-20")
    await create_transaction(client_a, card, shopping, amount_cents=4_590, date="2026-10-01")
    await create_transaction(client_a, card, refund, amount_cents=500, date="2026-09-25")
    await create_transaction(client_a, card, shopping, amount_cents=999, date="2026-09-02")
    await create_transaction(client_a, card, shopping, amount_cents=1_000, date="2026-10-03")
    await create_transaction(client_a, checking, shopping, amount_cents=7_777, date="2026-09-20")
    await _transfer(client_a, checking, card, amount_cents=30_000, date="2026-09-30")

    response = await client_a.get(CARDS)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {
                "account_id": card["id"],
                "name": "Cartão Nubank",
                "closing_day": 3,
                "due_day": 10,
                "current_invoice": {
                    "period_start": "2026-09-03",
                    "period_end": "2026-10-02",
                    "closing_date": "2026-10-03",
                    "due_date": "2026-10-10",
                    # Parcela 1 (R$ 400,00) e a compra de hoje, menos o estorno.
                    "amount_cents": 40_000 + 4_590 - 500,
                },
                "future_installments": {
                    "total_cents": 80_000,
                    # Por mês de vencimento da fatura em que cada parcela cai.
                    "months": [
                        {"month": "2026-11", "amount_cents": 40_000},
                        {"month": "2026-12", "amount_cents": 40_000},
                    ],
                },
            }
        ]
    }


async def test_cards_summary_lists_only_active_credit_cards(
    client_a: AsyncClient, card: Json, checking: Json, frozen_time: datetime
) -> None:
    archived = await create_account(
        client_a, name="Cartão antigo", type="credit_card", closing_day=31, due_day=8
    )
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")
    other = await create_account(
        client_a, name="Cartão Inter", type="credit_card", closing_day=31, due_day=8
    )

    items = (await client_a.get(CARDS)).json()["items"]

    assert [item["name"] for item in items] == ["Cartão Inter", "Cartão Nubank"]
    inter = items[0]
    # Fechamento no dia 31 em setembro, que tem 30 dias: vale o dia 30.
    assert inter["account_id"] == other["id"]
    assert inter["current_invoice"]["closing_date"] == "2026-10-31"
    assert inter["current_invoice"]["period_start"] == "2026-09-30"
    assert inter["future_installments"] == {"total_cents": 0, "months": []}


async def test_cards_summary_for_a_past_month_uses_the_invoice_open_at_its_end(
    client_a: AsyncClient, card: Json, shopping: Json
) -> None:
    await create_transaction(client_a, card, shopping, amount_cents=2_000, date="2026-07-31")

    july = (await client_a.get(CARDS, params={"month": "2026-07"})).json()["items"][0]

    # 31 de julho está na fatura de 3 de julho a 2 de agosto.
    assert july["current_invoice"]["closing_date"] == "2026-08-03"
    assert july["current_invoice"]["amount_cents"] == 2_000


# ---------- o painel continua batendo com a lista


async def test_panel_matches_the_list_after_installments_and_transfers(
    client_a: AsyncClient,
    card: Json,
    checking: Json,
    savings: Json,
    shopping: Json,
    refund: Json,
) -> None:
    await _installments(
        client_a, card, shopping, total_cents=100_000, installments=6, date="2026-08-31"
    )
    await _installments(
        client_a, card, shopping, total_cents=10_000, installments=3, date="2026-09-15"
    )
    await create_transaction(client_a, card, refund, amount_cents=1_500, date="2026-10-05")
    await create_transaction(client_a, checking, shopping, amount_cents=4_590, date="2026-09-01")
    await _transfer(client_a, checking, savings, amount_cents=50_000, date="2026-09-15")
    await _transfer(client_a, checking, card, amount_cents=16_667, date="2026-10-10")

    for month, last_day in (("2026-08", 31), ("2026-09", 30), ("2026-10", 31), ("2026-11", 30)):
        listed = await _all(client_a, **{"from": f"{month}-01", "to": f"{month}-{last_day}"})
        summary = await _summary(client_a, month)

        def total(kind: str, items: list[Json] = listed) -> int:
            return sum(item["amount_cents"] for item in items if item["type"] == kind)

        assert summary["income_cents"] == total("income"), month
        assert summary["expense_cents"] == total("expense"), month
        assert summary["net_cents"] == total("income") - total("expense"), month
