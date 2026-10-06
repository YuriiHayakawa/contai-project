"""Rotas do painel: resumo do mês, gastos por categoria, evolução e maiores gastos.

Os números do painel têm de bater com a lista de lançamentos do mesmo mês: é o que o usuário
confere na tela, e o que estes testes conferem pelas duas rotas (FR-055 a FR-059).
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.transactions.models import TransactionType, TransferDirection
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.models import User
from tests.finance import (
    ACCOUNTS,
    CATEGORIES,
    balance_of,
    create_account,
    create_category,
    create_transaction,
    list_transactions,
)

Json = dict[str, Any]

DASHBOARD = "/api/v1/dashboard"
SUMMARY = f"{DASHBOARD}/summary"
BY_CATEGORY = f"{DASHBOARD}/categories"
TREND = f"{DASHBOARD}/trend"
TOP_EXPENSES = f"{DASHBOARD}/top-expenses"
ALL_ROUTES = (SUMMARY, BY_CATEGORY, TREND, TOP_EXPENSES)


@pytest_asyncio.fixture
async def account(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_account(
        client_a,
        name="Conta Nubank",
        initial_balance_cents=100_000,
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
    return await create_category(client_a, name="Transporte", color="tinta", icon="car")


@pytest_asyncio.fixture
async def salary(client_a: AsyncClient, frozen_time: datetime) -> Json:
    return await create_category(client_a, name="Salário", kind="income", color="mostarda")


async def _get(client: AsyncClient, url: str, **params: object) -> Json:
    response = await client.get(url, params={key: str(value) for key, value in params.items()})
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def _transfer(
    session: AsyncSession, user: User, source: Json, target: Json, amount: int, on: date
) -> None:
    """Grava os dois lados de uma transferência; a rota de transferências chega na US4."""
    group = uuid.uuid4()
    repository = TransactionRepository(session)
    for account, direction in ((source, TransferDirection.OUT), (target, TransferDirection.IN)):
        await repository.create(
            user.id,
            account_id=uuid.UUID(account["id"]),
            transaction_type=TransactionType.TRANSFER,
            amount_cents=amount,
            date=on,
            description="Transferência",
            description_normalized="transferencia",
            fingerprint="0" * 64,
            created_at=clock.utcnow(),
            transfer_direction=direction,
            transfer_group_id=group,
        )


async def _every_transaction(client: AsyncClient, **filters: object) -> list[Json]:
    """Todas as páginas da lista de lançamentos, como o usuário veria rolando a tela."""
    items: list[Json] = []
    cursor: str | None = None
    while True:
        params = {**filters, "limit": 2, **({"cursor": cursor} if cursor else {})}
        page = await list_transactions(client, **params)
        items.extend(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            assert len(items) == page["total_count"]
            return items


def _sum(items: list[Json], kind: str) -> int:
    return sum(item["amount_cents"] for item in items if item["type"] == kind)


def _refunds(items: list[Json], *expense_categories: Json) -> int:
    """Os estornos da lista: as receitas lançadas em uma das categorias de despesa."""
    expense_ids = {category["id"] for category in expense_categories}
    return sum(
        item["amount_cents"]
        for item in items
        if item["type"] == "income" and item["category_id"] in expense_ids
    )


# ---------- resumo do mês


async def test_summary_shows_income_expense_net_and_the_balance_of_each_active_account(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    wallet = await create_account(client_a, name="Carteira", type="cash")
    archived = await create_account(client_a, name="Conta antiga")
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")
    await create_transaction(client_a, account, salary, amount_cents=350_000, date="2026-10-01")
    await create_transaction(client_a, account, food, amount_cents=4_590, date="2026-10-01")
    await create_transaction(client_a, wallet, food, amount_cents=1_250, date="2026-10-01")
    await create_transaction(client_a, account, food, amount_cents=99_999, date="2026-09-30")

    summary = await _get(client_a, SUMMARY, month="2026-10")

    assert summary == {
        "month": "2026-10",
        "income_cents": 350_000,
        "expense_cents": 5_840,
        "net_cents": 344_160,
        "accounts": [
            {"id": wallet["id"], "name": "Carteira", "type": "cash", "balance_cents": -1_250},
            {
                "id": account["id"],
                "name": "Conta Nubank",
                "type": "checking",
                "balance_cents": 100_000 + 350_000 - 4_590 - 99_999,
            },
        ],
    }


async def test_without_a_month_the_panel_shows_the_current_month_in_sao_paulo(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    await create_transaction(client_a, account, food, amount_cents=4_590, date="2026-09-30")
    await create_transaction(client_a, account, food, amount_cents=700, date="2026-10-01")

    # Meio-dia de 1º de outubro em Brasília.
    in_october = [await _get(client_a, url) for url in (SUMMARY, BY_CATEGORY, TOP_EXPENSES)]
    trend_in_october = await _get(client_a, TREND)
    # 23h30 de 30 de setembro em Brasília, que já é 1º de outubro em UTC.
    clock.set_fixed_time(datetime(2026, 10, 1, 2, 30, tzinfo=UTC))
    in_september = [await _get(client_a, url) for url in (SUMMARY, BY_CATEGORY, TOP_EXPENSES)]
    trend_in_september = await _get(client_a, TREND)

    assert [body["month"] for body in in_october] == ["2026-10"] * 3
    assert in_october[0]["expense_cents"] == 700
    assert trend_in_october["items"][-1]["month"] == "2026-10"
    assert [body["month"] for body in in_september] == ["2026-09"] * 3
    assert in_september[0]["expense_cents"] == 4_590
    assert trend_in_september["items"][-1]["month"] == "2026-09"


async def test_panel_totals_match_the_transaction_list_of_the_same_month(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    account: Json,
    food: Json,
    market: Json,
    transport: Json,
    salary: Json,
) -> None:
    savings = await create_account(
        client_a, name="Poupança", type="savings", initial_balance_date="2026-01-01"
    )
    for category, amount, day in (
        (salary, 350_000, "2026-09-05"),
        (salary, 12_000, "2026-09-30"),
        (food, 4_590, "2026-09-01"),
        (market, 38_620, "2026-09-12"),
        (market, 1_999, "2026-09-30"),
        (transport, 1_840, "2026-09-12"),
        (food, 77_700, "2026-08-31"),  # mês anterior
        (salary, 90_000, "2026-10-01"),  # mês seguinte
    ):
        await create_transaction(client_a, account, category, amount_cents=amount, date=day)
    # Dois estornos em setembro: receitas lançadas na categoria da compra.
    for category, amount, day in ((market, 1_999, "2026-09-30"), (transport, 840, "2026-09-20")):
        await create_transaction(
            client_a, account, category, type="income", amount_cents=amount, date=day
        )
    await _transfer(session, user_a, account, savings, 50_000, date(2026, 9, 15))
    balance_before = await balance_of(client_a, account)

    listed = await _every_transaction(client_a, **{"from": "2026-09-01", "to": "2026-09-30"})
    summary = await _get(client_a, SUMMARY, month="2026-09")
    by_category = await _get(client_a, BY_CATEGORY, month="2026-09")
    trend = await _get(client_a, TREND, until="2026-09", months=1)

    # A lista traz os dois lados da transferência; o painel não os conta em nenhum total.
    assert _sum(listed, "transfer") == 100_000
    # Na lista o estorno é uma receita; no painel ele abate as saídas e não soma nas entradas.
    refunds = _refunds(listed, food, market, transport)
    assert refunds == 2_839
    assert summary["income_cents"] == _sum(listed, "income") - refunds == 362_000
    assert summary["expense_cents"] == _sum(listed, "expense") - refunds == 47_049 - 2_839
    assert summary["net_cents"] == _sum(listed, "income") - _sum(listed, "expense")
    assert by_category["total_cents"] == summary["expense_cents"]
    assert sum(item["amount_cents"] for item in by_category["items"]) == summary["expense_cents"]
    assert trend["items"] == [
        {
            "month": "2026-09",
            "income_cents": summary["income_cents"],
            "expense_cents": summary["expense_cents"],
            "net_cents": summary["net_cents"],
        }
    ]
    # A transferência muda os saldos das duas contas, e só os saldos (FR-033).
    balances = {item["name"]: item["balance_cents"] for item in summary["accounts"]}
    assert balances == {"Conta Nubank": balance_before, "Poupança": 50_000}
    # No saldo da conta o estorno entra como o dinheiro que voltou.
    assert balance_before == 100_000 + 362_000 + 90_000 - 47_049 + 2_839 - 77_700 - 50_000


# ---------- gastos por categoria


async def test_category_amount_equals_the_sum_of_its_transactions_in_the_list(
    client_a: AsyncClient, account: Json, food: Json, market: Json, transport: Json, salary: Json
) -> None:
    await create_transaction(client_a, account, food, amount_cents=4_590, date="2026-10-01")
    await create_transaction(client_a, account, market, amount_cents=38_620, date="2026-10-12")
    await create_transaction(client_a, account, market, amount_cents=6_790, date="2026-10-31")
    await create_transaction(client_a, account, transport, amount_cents=50_000, date="2026-10-12")
    await create_transaction(client_a, account, market, amount_cents=9_999, date="2026-09-30")
    await create_transaction(client_a, account, salary, amount_cents=350_000, date="2026-10-05")
    # Uma compra de mercado devolvida no mesmo mês: o estorno abate a subcategoria e a principal.
    await create_transaction(client_a, account, market, amount_cents=2_500, date="2026-10-20")
    await create_transaction(
        client_a, account, market, type="income", amount_cents=2_500, date="2026-10-22"
    )

    body = await _get(client_a, BY_CATEGORY, month="2026-10")

    assert body["month"] == "2026-10"
    assert body["total_cents"] == 100_000
    assert [(item["name"], item["amount_cents"], item["percent"]) for item in body["items"]] == [
        ("Alimentação", 50_000, 50.0),
        ("Transporte", 50_000, 50.0),
    ]
    food_item, transport_item = body["items"]
    assert food_item["subcategories"] == [
        {
            "category_id": market["id"],
            "name": "Mercado",
            "icon": "utensils",
            "color": "caqui",
            "amount_cents": 45_410,
            "percent": 45.4,
        }
    ]
    assert (transport_item["icon"], transport_item["color"]) == ("car", "tinta")
    # Abrir a categoria no painel leva à lista filtrada por ela: as somas são iguais.
    month = {"from": "2026-10-01", "to": "2026-10-31"}
    for item in (food_item, transport_item, food_item["subcategories"][0]):
        listed = await _every_transaction(client_a, category_id=item["category_id"], **month)
        assert _sum(listed, "expense") - _sum(listed, "income") == item["amount_cents"]


async def test_a_purchase_refunded_in_the_same_month_leaves_the_category_at_zero(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    # Comprei e devolvi um livro: R$ 0 em Educação, e nada a mais em entradas ou saídas.
    education = await create_category(
        client_a, name="Educação", color="ameixa", icon="graduation-cap"
    )
    await create_transaction(client_a, account, salary, amount_cents=350_000, date="2026-09-05")
    await create_transaction(client_a, account, food, amount_cents=4_590, date="2026-09-08")
    before = await _get(client_a, SUMMARY, month="2026-09")
    balance_before = await balance_of(client_a, account)

    await create_transaction(
        client_a, account, education, amount_cents=5_000, date="2026-09-10", description="Livro"
    )
    await create_transaction(
        client_a,
        account,
        education,
        type="income",
        amount_cents=5_000,
        date="2026-09-17",
        description="Estorno livro",
    )

    summary = await _get(client_a, SUMMARY, month="2026-09")
    by_category = await _get(client_a, BY_CATEGORY, month="2026-09")
    trend = await _get(client_a, TREND, until="2026-09", months=1)
    totals = ("income_cents", "expense_cents", "net_cents")
    assert {key: summary[key] for key in totals} == {key: before[key] for key in totals}
    assert (summary["income_cents"], summary["expense_cents"]) == (350_000, 4_590)
    # Educação não aparece: a compra e o estorno se anulam.
    assert [
        (item["name"], item["amount_cents"], item["percent"]) for item in by_category["items"]
    ] == [("Alimentação", 4_590, 100.0)]
    assert by_category["total_cents"] == summary["expense_cents"]
    assert trend["items"][0]["expense_cents"] == 4_590
    # A compra continua na lista das maiores despesas: ela aconteceu.
    top = await _get(client_a, TOP_EXPENSES, month="2026-09")
    assert top["items"][0]["description"] == "Livro"
    assert await balance_of(client_a, account) == balance_before


async def test_a_refund_in_another_month_makes_the_category_negative_in_that_month(
    client_a: AsyncClient, account: Json, food: Json, transport: Json, salary: Json
) -> None:
    education = await create_category(
        client_a, name="Educação", color="ameixa", icon="graduation-cap"
    )
    # O livro foi comprado em setembro e devolvido em outubro.
    await create_transaction(client_a, account, education, amount_cents=5_000, date="2026-09-28")
    await create_transaction(
        client_a, account, education, type="income", amount_cents=5_000, date="2026-10-03"
    )
    await create_transaction(client_a, account, food, amount_cents=30_000, date="2026-10-01")
    await create_transaction(client_a, account, transport, amount_cents=10_000, date="2026-10-02")
    await create_transaction(client_a, account, salary, amount_cents=350_000, date="2026-10-05")

    september = await _get(client_a, BY_CATEGORY, month="2026-09")
    october = await _get(client_a, BY_CATEGORY, month="2026-10")
    summary = await _get(client_a, SUMMARY, month="2026-10")
    trend = await _get(client_a, TREND, until="2026-10", months=2)

    # Setembro fica com a compra inteira.
    assert [(item["name"], item["amount_cents"]) for item in september["items"]] == [
        ("Educação", 5_000)
    ]
    # Em outubro a categoria aparece negativa, no fim e sem percentual; as outras somam 100%.
    assert [(item["name"], item["amount_cents"], item["percent"]) for item in october["items"]] == [
        ("Alimentação", 30_000, 75.0),
        ("Transporte", 10_000, 25.0),
        ("Educação", -5_000, 0.0),
    ]
    # A soma das categorias continua igual ao total de saídas, e o estorno não é entrada.
    assert october["total_cents"] == summary["expense_cents"] == 35_000
    assert summary["income_cents"] == 350_000
    assert summary["net_cents"] == 350_000 - 35_000
    assert [
        (item["month"], item["income_cents"], item["expense_cents"]) for item in trend["items"]
    ] == [
        ("2026-09", 0, 5_000),
        ("2026-10", 350_000, 35_000),
    ]


async def test_a_month_with_only_a_refund_has_negative_spending(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    await create_transaction(
        client_a, account, food, type="income", amount_cents=4_590, date="2026-10-01"
    )

    summary = await _get(client_a, SUMMARY, month="2026-10")
    by_category = await _get(client_a, BY_CATEGORY, month="2026-10")

    assert (summary["income_cents"], summary["expense_cents"], summary["net_cents"]) == (
        0,
        -4_590,
        4_590,
    )
    assert [
        (item["name"], item["amount_cents"], item["percent"]) for item in by_category["items"]
    ] == [("Alimentação", -4_590, 0.0)]
    assert by_category["total_cents"] == -4_590


async def test_an_archived_category_still_appears_with_its_spending(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    await create_transaction(client_a, account, food, amount_cents=4_590, date="2026-10-01")
    await client_a.post(f"{CATEGORIES}/{food['id']}/archive")

    body = await _get(client_a, BY_CATEGORY)

    assert [(item["name"], item["amount_cents"]) for item in body["items"]] == [
        ("Alimentação", 4_590)
    ]


# ---------- evolução


async def test_trend_shows_six_months_up_to_the_current_one_by_default(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    await create_transaction(client_a, account, salary, amount_cents=300_000, date="2026-05-10")
    await create_transaction(client_a, account, food, amount_cents=40_000, date="2026-07-31")
    await create_transaction(client_a, account, food, amount_cents=700, date="2026-10-01")
    await create_transaction(client_a, account, food, amount_cents=5_555, date="2026-04-30")

    body = await _get(client_a, TREND)

    assert body == {
        "items": [
            {"month": "2026-05", "income_cents": 300_000, "expense_cents": 0, "net_cents": 300_000},
            {"month": "2026-06", "income_cents": 0, "expense_cents": 0, "net_cents": 0},
            {"month": "2026-07", "income_cents": 0, "expense_cents": 40_000, "net_cents": -40_000},
            {"month": "2026-08", "income_cents": 0, "expense_cents": 0, "net_cents": 0},
            {"month": "2026-09", "income_cents": 0, "expense_cents": 0, "net_cents": 0},
            {"month": "2026-10", "income_cents": 0, "expense_cents": 700, "net_cents": -700},
        ]
    }


async def test_trend_accepts_the_last_month_and_the_number_of_months(
    client_a: AsyncClient, account: Json, food: Json
) -> None:
    await create_transaction(client_a, account, food, amount_cents=5_555, date="2026-04-30")

    until_june = await _get(client_a, TREND, until="2026-06", months=3)
    # `month` é o parâmetro comum das rotas do painel: a evolução termina no mês exibido.
    by_month = await _get(client_a, TREND, month="2026-06", months=3)

    assert [item["month"] for item in until_june["items"]] == ["2026-04", "2026-05", "2026-06"]
    assert until_june["items"][0]["expense_cents"] == 5_555
    assert by_month == until_june


# ---------- maiores gastos


async def test_top_expenses_lists_the_five_largest_of_the_month_by_default(
    client_a: AsyncClient, account: Json, food: Json, salary: Json
) -> None:
    amounts = {"Aluguel": 120_000, "Mercado": 38_620, "Farmácia": 6_275, "iFood": 4_590}
    for description, amount in amounts.items():
        await create_transaction(
            client_a, account, food, amount_cents=amount, description=description
        )
    for cents in (100, 200, 300):
        await create_transaction(
            client_a, account, food, amount_cents=cents, description=f"Café {cents}"
        )
    await create_transaction(client_a, account, salary, amount_cents=900_000, description="Salário")
    await create_transaction(
        client_a, account, food, amount_cents=999_999, date="2026-09-30", description="Setembro"
    )

    by_default = await _get(client_a, TOP_EXPENSES)
    top_two = await _get(client_a, TOP_EXPENSES, limit=2, month="2026-10")

    assert by_default["month"] == "2026-10"
    assert [(item["description"], item["amount_cents"]) for item in by_default["items"]] == [
        ("Aluguel", 120_000),
        ("Mercado", 38_620),
        ("Farmácia", 6_275),
        ("iFood", 4_590),
        ("Café 300", 300),
    ]
    assert [item["description"] for item in top_two["items"]] == ["Aluguel", "Mercado"]
    # Cada item é um lançamento completo, como na lista: dá para abrir o detalhe dele.
    first = by_default["items"][0]
    assert (first["type"], first["account_id"], first["category_id"], first["date"]) == (
        "expense",
        account["id"],
        food["id"],
        "2026-10-01",
    )


# ---------- sem dados, entrada inválida e acesso


async def test_a_user_without_data_sees_zeros_and_empty_lists(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    assert await _get(client_a, SUMMARY) == {
        "month": "2026-10",
        "income_cents": 0,
        "expense_cents": 0,
        "net_cents": 0,
        "accounts": [],
    }
    assert await _get(client_a, BY_CATEGORY) == {"month": "2026-10", "total_cents": 0, "items": []}
    assert await _get(client_a, TOP_EXPENSES) == {"month": "2026-10", "items": []}
    trend = await _get(client_a, TREND)
    assert len(trend["items"]) == 6
    assert {item["income_cents"] + item["expense_cents"] for item in trend["items"]} == {0}


@pytest.mark.parametrize("url", [SUMMARY, BY_CATEGORY, TOP_EXPENSES, TREND])
@pytest.mark.parametrize("month", ["2026-13", "10/2026", "2026-10-01", "outubro"])
async def test_a_month_in_another_format_is_refused(
    client_a: AsyncClient, url: str, month: str
) -> None:
    response = await client_a.get(url, params={"month": month})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "AAAA-MM" in error["details"]["fields"]["month"]


@pytest.mark.parametrize(
    ("url", "params", "field"),
    [
        (TREND, {"until": "2026"}, "until"),
        (TREND, {"months": "0"}, "months"),
        (TREND, {"months": "25"}, "months"),
        (TOP_EXPENSES, {"limit": "0"}, "limit"),
        (TOP_EXPENSES, {"limit": "21"}, "limit"),
    ],
)
async def test_parameters_out_of_range_are_refused(
    client_a: AsyncClient, url: str, params: dict[str, str], field: str
) -> None:
    response = await client_a.get(url, params=params)

    assert response.status_code == 422
    assert field in response.json()["error"]["details"]["fields"]


async def test_the_panel_requires_authentication(client: AsyncClient) -> None:
    for url in ALL_ROUTES:
        response = await client.get(url)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"
