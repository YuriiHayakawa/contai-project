"""Despesas e receitas: criar, buscar, paginar, editar e excluir (FR-027, FR-034, FR-035)."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.accounts.models import Account
from app.modules.categories.models import Category
from app.modules.transactions.models import Transaction
from app.modules.transactions.normalize import fingerprint
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from tests.finance import (
    ACCOUNTS,
    CATEGORIES,
    TRANSACTIONS,
    balance_of,
    create_account,
    create_category,
    create_transaction,
    descriptions,
    list_transactions,
)

Json = dict[str, Any]


@pytest_asyncio.fixture
async def account(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a, initial_balance_cents=100_000, initial_balance_date="2026-09-01"
    )


@pytest_asyncio.fixture
async def food(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Alimentação")


@pytest_asyncio.fixture
async def salary(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Salário", kind="income", color="mostarda")


def _payload(account: Json, category: Json, **overrides: object) -> Json:
    return {
        "type": category["kind"],
        "amount_cents": 4590,
        "date": "2026-10-01",
        "description": "Padaria São João",
        "account_id": account["id"],
        "category_id": category["id"],
        **overrides,
    }


# ---------- criar


async def test_create_expense(
    client_a: AsyncClient, session: AsyncSession, account: Json, food: Json
) -> None:
    response = await client_a.post(
        TRANSACTIONS,
        json=_payload(account, food, description="  Padaria São João 12/05  ", notes="pão e leite"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "id": body["id"],
        "type": "expense",
        "transfer_direction": None,
        "amount_cents": 4590,
        "date": "2026-10-01",
        "description": "Padaria São João 12/05",
        "notes": "pão e leite",
        "account_id": account["id"],
        "category_id": food["id"],
        "transfer_group_id": None,
        "installment_group_id": None,
        "installment_number": None,
        "installment_count": None,
        "source": "manual",
        "created_at": body["created_at"],
    }

    stored = await session.get(Transaction, uuid.UUID(body["id"]))
    assert stored is not None
    assert stored.description_normalized == "padaria sao joao"
    assert stored.fingerprint == fingerprint(
        account_id=uuid.UUID(account["id"]),
        date=stored.date,
        transaction_type="expense",
        amount_cents=4590,
        description_normalized="padaria sao joao",
    )


async def test_expense_of_45_90_lowers_the_balance_by_exactly_45_90(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    await create_transaction(client_a, account, food, amount_cents=4590)
    assert await balance_of(client_a, account) == 100_000 - 4590

    await create_transaction(client_a, account, salary, amount_cents=250_000, description="Salário")
    assert await balance_of(client_a, account) == 100_000 - 4590 + 250_000


async def test_transaction_before_the_reference_date_is_kept_but_does_not_change_the_balance(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    old = await create_transaction(client_a, account, food, date="2026-08-31", description="Antiga")
    await create_transaction(client_a, account, food, date="2026-09-01", amount_cents=1000)
    future = await create_transaction(client_a, account, food, date="2026-10-02", amount_cents=7)

    assert await balance_of(client_a, account) == 100_000 - 1000
    # Fora do saldo, mas presentes na lista: o painel e os relatórios contam com elas.
    listed = {item["id"] for item in (await list_transactions(client_a))["items"]}
    assert {old["id"], future["id"]} <= listed


@pytest.mark.parametrize("amount", [0, -4590, 45.9, "abc", None])
async def test_amount_must_be_a_positive_integer_in_cents(
    client_a: AsyncClient, account: Json, food: Json, amount: object
) -> None:
    response = await client_a.post(TRANSACTIONS, json=_payload(account, food, amount_cents=amount))

    assert response.status_code == 422
    assert "amount_cents" in response.json()["error"]["details"]["fields"]
    assert (await list_transactions(client_a))["total_count"] == 0


@pytest.mark.parametrize(
    "invalid",
    [
        {"description": "   "},
        {"description": "x" * 201},
        {"date": "01/10/2026"},
        {"type": "transfer"},
        {"notes": "x" * 1001},
    ],
)
async def test_create_validates_the_fields(
    client_a: AsyncClient, account: Json, food: Json, invalid: dict[str, object]
) -> None:
    response = await client_a.post(TRANSACTIONS, json=_payload(account, food, **invalid))

    assert response.status_code == 422
    assert set(response.json()["error"]["details"]["fields"]) == set(invalid)


async def test_account_must_exist_and_be_active(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    unknown = await client_a.post(
        TRANSACTIONS, json=_payload(account, food, account_id=str(uuid.uuid4()))
    )
    await client_a.post(f"{ACCOUNTS}/{account['id']}/archive")
    archived = await client_a.post(TRANSACTIONS, json=_payload(account, food))

    assert unknown.status_code == archived.status_code == 422
    assert "account_id" in unknown.json()["error"]["details"]["fields"]
    assert "arquivada" in archived.json()["error"]["details"]["fields"]["account_id"]


async def test_category_must_exist_be_active_and_match_the_type(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    unknown = await client_a.post(
        TRANSACTIONS, json=_payload(account, food, category_id=str(uuid.uuid4()))
    )
    wrong_kind = await client_a.post(TRANSACTIONS, json=_payload(account, salary, type="expense"))
    missing = await client_a.post(
        TRANSACTIONS,
        json={k: v for k, v in _payload(account, food).items() if k != "category_id"},
    )

    assert unknown.status_code == wrong_kind.status_code == missing.status_code == 422
    assert "category_id" in unknown.json()["error"]["details"]["fields"]
    assert "receita" in wrong_kind.json()["error"]["details"]["fields"]["category_id"]


async def test_subcategory_can_be_used_in_a_transaction(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    market = await create_category(client_a, name="Mercado", parent_id=food["id"])

    transaction = await create_transaction(client_a, account, market)

    assert transaction["category_id"] == market["id"]


# ---------- consultar


async def test_get_transaction_and_404_for_unknown(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    transaction = await create_transaction(client_a, account, food)

    found = await client_a.get(f"{TRANSACTIONS}/{transaction['id']}")
    missing = await client_a.get(f"{TRANSACTIONS}/{uuid.uuid4()}")

    assert found.json() == transaction
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "not_found")


@pytest_asyncio.fixture
async def ledger(
    client_a: AsyncClient, account: Json, food: Json, salary: Json, frozen_time: datetime
) -> Json:
    """Um pequeno extrato em duas contas, com categoria, subcategoria e receita.

    Cada linha é lançada um minuto depois da anterior: no mesmo dia, a mais nova vem primeiro.
    """
    savings = await create_account(client_a, name="Poupança", type="savings")
    market = await create_category(client_a, name="Mercado", parent_id=food["id"])
    fun = await create_category(client_a, name="Lazer", color="goiaba")
    rows = [
        (account, food, "Padaria São João", 1_000, "2026-09-10", None),
        (account, market, "Mercado Extra", 20_000, "2026-09-20", "compra do mês"),
        (account, fun, "Cinema", 4_000, "2026-09-25", None),
        (account, salary, "Salário de setembro", 500_000, "2026-09-30", None),
        (savings, market, "Feira", 3_000, "2026-09-20", None),
        (account, food, "Padaria da esquina", 1_500, "2026-10-01", "pão de queijo"),
    ]
    for minute, (row_account, category, description, amount, day, notes) in enumerate(rows):
        clock.set_fixed_time(frozen_time + timedelta(minutes=minute))
        await create_transaction(
            client_a,
            row_account,
            category,
            description=description,
            amount_cents=amount,
            date=day,
            notes=notes,
        )
    return {"account": account, "savings": savings, "food": food, "market": market, "fun": fun}


async def test_list_is_ordered_from_the_newest_date_and_reports_the_total(
    client_a: AsyncClient, ledger: Json
) -> None:
    page = await list_transactions(client_a)

    assert descriptions(page) == [
        "Padaria da esquina",
        "Salário de setembro",
        "Cinema",
        "Feira",
        "Mercado Extra",
        "Padaria São João",
    ]
    assert (page["total_count"], page["next_cursor"]) == (6, None)


@pytest.mark.parametrize(
    ("filters", "expected"),
    [
        ({"from": "2026-09-20", "to": "2026-09-25"}, ["Cinema", "Feira", "Mercado Extra"]),
        ({"from": "2026-10-01"}, ["Padaria da esquina"]),
        ({"to": "2026-09-10"}, ["Padaria São João"]),
        ({"type": "income"}, ["Salário de setembro"]),
        ({"q": "padaria"}, ["Padaria da esquina", "Padaria São João"]),
        # Sem acento e em maiúsculas, a busca encontra o mesmo.
        ({"q": "SAO JOAO"}, ["Padaria São João"]),
        # O texto também é procurado na observação.
        ({"q": "pão de queijo"}, ["Padaria da esquina"]),
        ({"q": "compra do mes"}, ["Mercado Extra"]),
        ({"q": "100%"}, []),
        ({"q": "não existe"}, []),
    ],
)
async def test_filters_by_period_type_and_text(
    client_a: AsyncClient, ledger: Json, filters: dict[str, str], expected: list[str]
) -> None:
    page = await list_transactions(client_a, **filters)

    assert descriptions(page) == expected
    assert page["total_count"] == len(expected)


async def test_filter_by_account_and_by_category_including_its_subcategories(
    client_a: AsyncClient, ledger: Json
) -> None:
    by_account = await list_transactions(client_a, account_id=ledger["savings"]["id"])
    by_parent = await list_transactions(client_a, category_id=ledger["food"]["id"])
    by_child = await list_transactions(client_a, category_id=ledger["market"]["id"])

    assert descriptions(by_account) == ["Feira"]
    # A categoria mãe traz também o que está nas subcategorias dela.
    assert descriptions(by_parent) == [
        "Padaria da esquina",
        "Feira",
        "Mercado Extra",
        "Padaria São João",
    ]
    assert descriptions(by_child) == ["Feira", "Mercado Extra"]


async def test_filters_combine_and_only_rows_matching_all_of_them_come_back(
    client_a: AsyncClient, ledger: Json
) -> None:
    page = await list_transactions(
        client_a,
        **{
            "from": "2026-09-01",
            "to": "2026-09-30",
            "account_id": ledger["account"]["id"],
            "category_id": ledger["food"]["id"],
            "type": "expense",
            "q": "mercado",
        },
    )

    assert descriptions(page) == ["Mercado Extra"]
    assert page["total_count"] == 1


async def test_filter_by_ids(client_a: AsyncClient, ledger: Json) -> None:
    everything = (await list_transactions(client_a))["items"]
    wanted = [everything[0]["id"], everything[3]["id"]]

    response = await client_a.get(TRANSACTIONS, params=[("ids", wanted[0]), ("ids", wanted[1])])

    assert [item["id"] for item in response.json()["items"]] == wanted


async def test_pagination_walks_every_row_once(client_a: AsyncClient, ledger: Json) -> None:
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(4):
        params = {"limit": "2", **({"cursor": cursor} if cursor else {})}
        page = (await client_a.get(TRANSACTIONS, params=params)).json()
        assert page["total_count"] == 6
        seen.extend(item["description"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == [
        "Padaria da esquina",
        "Salário de setembro",
        "Cinema",
        "Feira",
        "Mercado Extra",
        "Padaria São João",
    ]


async def test_rows_of_the_same_day_come_newest_first_and_paginate_without_repeating(
    client_a: AsyncClient, account: Json, food: Json, frozen_time: datetime
) -> None:
    for index in range(5):
        clock.set_fixed_time(frozen_time + timedelta(minutes=index))
        await create_transaction(client_a, account, food, description=f"Compra {index}")

    first = (await client_a.get(TRANSACTIONS, params={"limit": "3"})).json()
    second = (
        await client_a.get(TRANSACTIONS, params={"limit": "3", "cursor": first["next_cursor"]})
    ).json()

    assert descriptions(first) + descriptions(second) == [
        f"Compra {index}" for index in (4, 3, 2, 1, 0)
    ]
    assert second["next_cursor"] is None


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "201"},
        {"cursor": "não-é-um-cursor"},
        {"from": "ontem"},
        {"type": "despesa"},
        {"account_id": "abc"},
    ],
)
async def test_invalid_list_parameters_are_422(
    client_a: AsyncClient, account: Json, params: dict[str, str]
) -> None:
    response = await client_a.get(TRANSACTIONS, params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# ---------- editar e excluir


async def test_editing_the_amount_updates_the_list_and_the_balance(
    client_a: AsyncClient, session: AsyncSession, account: Json, food: Json
) -> None:
    transaction = await create_transaction(client_a, account, food, amount_cents=4590)

    response = await client_a.patch(
        f"{TRANSACTIONS}/{transaction['id']}",
        json={"amount_cents": 5000, "description": "Padaria Nova", "notes": "corrigido"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["amount_cents"], body["description"], body["notes"]) == (
        5000,
        "Padaria Nova",
        "corrigido",
    )
    assert (body["date"], body["category_id"]) == ("2026-10-01", food["id"])
    assert await balance_of(client_a, account) == 100_000 - 5000

    stored = await session.get(Transaction, uuid.UUID(transaction["id"]), populate_existing=True)
    assert stored is not None
    assert stored.description_normalized == "padaria nova"
    assert stored.fingerprint == fingerprint(
        account_id=uuid.UUID(account["id"]),
        date=stored.date,
        transaction_type="expense",
        amount_cents=5000,
        description_normalized="padaria nova",
    )


async def test_editing_can_move_the_transaction_to_another_account_date_and_category(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    savings = await create_account(
        client_a, name="Poupança", type="savings", initial_balance_date="2026-09-01"
    )
    transaction = await create_transaction(client_a, account, food, amount_cents=1000)

    moved = await client_a.patch(
        f"{TRANSACTIONS}/{transaction['id']}",
        json={"account_id": savings["id"], "date": "2026-09-30"},
    )
    to_income = await client_a.patch(
        f"{TRANSACTIONS}/{transaction['id']}", json={"type": "income", "category_id": salary["id"]}
    )
    clear_notes = await client_a.patch(f"{TRANSACTIONS}/{transaction['id']}", json={"notes": None})

    assert (moved.status_code, moved.json()["account_id"]) == (200, savings["id"])
    assert await balance_of(client_a, account) == 100_000
    assert (to_income.json()["type"], to_income.json()["category_id"]) == ("income", salary["id"])
    assert await balance_of(client_a, savings) == 1000
    assert clear_notes.json()["notes"] is None


async def test_edit_validates_like_create(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    transaction = await create_transaction(client_a, account, food)
    url = f"{TRANSACTIONS}/{transaction['id']}"
    archived = await create_account(client_a, name="Antiga")
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")

    responses = {
        "amount_cents": await client_a.patch(url, json={"amount_cents": 0}),
        "description": await client_a.patch(url, json={"description": " "}),
        "account_id": await client_a.patch(url, json={"account_id": archived["id"]}),
        # Virar receita mantendo uma categoria de despesa não fecha.
        "category_id": await client_a.patch(url, json={"type": "income"}),
    }

    for field, response in responses.items():
        assert response.status_code == 422, field
        assert field in response.json()["error"]["details"]["fields"], field
    assert (await client_a.get(url)).json() == transaction


async def test_old_transaction_can_be_edited_while_its_category_and_account_are_archived(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    transaction = await create_transaction(client_a, account, food)
    await client_a.post(f"{CATEGORIES}/{food['id']}/archive")
    await client_a.post(f"{ACCOUNTS}/{account['id']}/archive")

    response = await client_a.patch(
        f"{TRANSACTIONS}/{transaction['id']}", json={"description": "Padaria (corrigido)"}
    )

    assert response.status_code == 200
    assert (response.json()["category_id"], response.json()["account_id"]) == (
        food["id"],
        account["id"],
    )


async def test_delete_removes_the_transaction_and_restores_the_balance(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    transaction = await create_transaction(client_a, account, food)
    other = await create_transaction(client_a, account, food, amount_cents=10, description="Outra")

    deleted = await client_a.delete(f"{TRANSACTIONS}/{transaction['id']}")

    assert deleted.status_code == 204
    assert (await client_a.get(f"{TRANSACTIONS}/{transaction['id']}")).status_code == 404
    assert [item["id"] for item in (await list_transactions(client_a))["items"]] == [other["id"]]
    assert await balance_of(client_a, account) == 100_000 - 10
    assert (await client_a.delete(f"{TRANSACTIONS}/{transaction['id']}")).status_code == 404


async def test_transactions_require_authentication(client: AsyncClient) -> None:
    assert (await client.get(TRANSACTIONS)).status_code == 401
    assert (await client.post(TRANSACTIONS, json={})).status_code == 401


async def test_deleting_the_user_removes_accounts_categories_and_transactions(
    client_a: AsyncClient, session: AsyncSession, user_a: User, account: Json, food: Json
) -> None:
    # A conta não pode ser apagada enquanto tem transações, mas a exclusão do usuário leva
    # tudo junto, em cascata.
    await create_transaction(client_a, account, food)

    await UserRepository(session).delete(user_a.id)
    await session.flush()

    for model in (Transaction, Account, Category):
        remaining = await session.execute(select(func.count()).select_from(model))
        assert remaining.scalar_one() == 0
