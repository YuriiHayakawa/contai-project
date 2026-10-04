"""As ferramentas do assistente (contracts/assistant-tools.md).

Cada ferramenta tem de devolver os mesmos números do `ReportingService`, que é o que o painel
mostra (FR-062), com todo valor em centavos e já formatado, e com as transações que compõem
os valores. O `user_id` vem do contexto: o que é de outro usuário não existe para a ferramenta.
"""

import datetime as dt
import uuid
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assistant import tools
from app.modules.assistant.tools.base import ToolContext, ToolResult, money
from app.modules.categories.models import CategoryKind
from app.modules.dashboard.service import Period, ReportingService
from app.modules.users.models import User
from tests.assistant import (
    AUGUST_EXPENSES,
    INJECTION,
    OCTOBER_EXPENSES,
    OCTOBER_FOOD,
    SEPTEMBER_EXPENSES,
    SEPTEMBER_FOOD,
    YEAR_INCOME,
    Finances,
    seed_finances,
)
from tests.finance import create_account, create_category, list_transactions

pytestmark = pytest.mark.usefixtures("frozen_time")

TODAY = dt.date(2026, 10, 1)
AUGUST = Period(dt.date(2026, 8, 1), dt.date(2026, 8, 31))
SEPTEMBER = Period(dt.date(2026, 9, 1), dt.date(2026, 9, 30))
OCTOBER = Period(dt.date(2026, 10, 1), dt.date(2026, 10, 31))
THIS_MONTH = {"preset": "this_month"}
LAST_MONTH = {"preset": "last_month"}
IN_AUGUST = {"preset": "month", "year": 2026, "month": 8}


@pytest_asyncio.fixture
async def finances(client_a: AsyncClient) -> Finances:
    return await seed_finances(client_a)


@pytest.fixture
def context(session: AsyncSession, user_a: User) -> ToolContext:
    return ToolContext(session=session, user_id=user_a.id, today=TODAY)


async def _run(context: ToolContext, name: str, **arguments: Any) -> ToolResult:
    result = await tools.execute(context, name, arguments)
    assert not result.is_error, result.data
    return result


async def _ids(client: AsyncClient, **filters: object) -> set[str]:
    page = await list_transactions(client, limit=200, **filters)
    return {item["id"] for item in page["items"]}


def test_every_tool_of_the_contract_is_offered_and_none_takes_a_user_id() -> None:
    specs = {spec.name: spec for spec in tools.specs()}

    assert set(specs) == {
        "get_spending_summary",
        "get_income_summary",
        "compare_periods",
        "get_top_expenses",
        "search_transactions",
        "get_account_balances",
        "get_card_invoices",
        "propose_transaction",
    }
    for spec in specs.values():
        assert spec.description
        assert "user_id" not in str(spec.parameters)
        # O schema vai sem referências: o período aparece por inteiro em cada ferramenta.
        assert "$ref" not in str(spec.parameters) and "$defs" not in str(spec.parameters)
    period = specs["get_spending_summary"].parameters["properties"]["period"]
    assert period["required"] == ["preset"]
    assert "from" in period["properties"]


# ---------- get_spending_summary


async def test_spending_total_is_the_same_as_the_dashboard(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    result = await _run(context, "get_spending_summary", period=LAST_MONTH)

    reports = ReportingService(context.session)
    expected = (await reports.totals(context.user_id, SEPTEMBER)).expense_cents
    assert expected == SEPTEMBER_EXPENSES
    assert result.data["total"] == {"cents": expected, "formatted": "R$\N{NO-BREAK SPACE}840,00"}
    assert result.data["period"] == {
        "from": "2026-09-01",
        "to": "2026-09-30",
        "label": "setembro de 2026",
    }
    assert result.highlight == "R$\N{NO-BREAK SPACE}840,00"
    # As transações que compõem o valor: as despesas e o estorno; o salário e a transferência
    # ficam de fora.
    in_september = {"from": "2026-09-01", "to": "2026-09-30"}
    entries = await _ids(client_a, type="expense", **in_september) | await _ids(
        client_a, q="Estorno", **in_september
    )
    assert {str(item) for item in result.transaction_ids} == entries
    assert result.transaction_count == result.data["transaction_count"] == len(entries) == 8
    assert "transaction_ids" not in result.data


async def test_spending_by_category_is_the_category_chart_of_the_dashboard(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(context, "get_spending_summary", period=LAST_MONTH, group_by="category")

    chart = await ReportingService(context.session).spending_by_category(context.user_id, SEPTEMBER)
    assert result.data["total"]["cents"] == chart.total_cents
    assert [
        (group["name"], group["amount"]["cents"], group["percent"])
        for group in result.data["groups"]
    ] == [
        (item.name, item.amount_cents, f"{item.percent:.1f}%".replace(".", ","))
        for item in chart.items
    ]
    # Compras 400,00; Alimentação 340,00, com as subcategorias somadas; o estorno abate Saúde.
    assert [(group["name"], group["amount"]["cents"]) for group in result.data["groups"]] == [
        ("Compras", 40_000),
        ("Alimentação", SEPTEMBER_FOOD),
        ("Saúde", 6_000),
        ("Transporte", 4_000),
    ]
    assert result.data["groups"][0]["percent"] == "47,6%"


async def test_the_current_month_counts_future_dated_entries_like_the_dashboard(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(
        context, "get_spending_summary", period=THIS_MONTH, category_ids=[finances.food["id"]]
    )

    chart = await ReportingService(context.session).spending_by_category(context.user_id, OCTOBER)
    food = next(item for item in chart.items if item.name == "Alimentação")
    # A categoria principal inclui as subcategorias, e o mercado do dia 15 já conta.
    assert result.data["total"]["cents"] == food.amount_cents == OCTOBER_FOOD
    assert result.data["period"]["label"] == "outubro de 2026"
    assert result.transaction_count == 3
    total = await _run(context, "get_spending_summary", period=THIS_MONTH)
    assert total.data["total"]["cents"] == OCTOBER_EXPENSES


async def test_spending_by_description_and_month(context: ToolContext, finances: Finances) -> None:
    result = await _run(
        context,
        "get_spending_summary",
        period={"preset": "last_n_months", "n": 3},
        description_contains="UBER",
        group_by="month",
    )

    assert result.data["period"]["label"] == "agosto a outubro de 2026"
    assert result.data["total"]["cents"] == 4_000 + 2_500 + 3_000 + 5_500
    assert [(group["name"], group["amount"]["cents"]) for group in result.data["groups"]] == [
        ("agosto de 2026", 6_500),
        ("setembro de 2026", 3_000),
        ("outubro de 2026", 5_500),
    ]
    assert result.transaction_count == 4
    assert result.summary == (
        "Despesas em agosto a outubro de 2026: R$\N{NO-BREAK SPACE}150,00, em 4 lançamentos."
    )


async def test_spending_by_subcategory_and_account(
    context: ToolContext, finances: Finances
) -> None:
    by_subcategory = await _run(
        context, "get_spending_summary", period=LAST_MONTH, group_by="subcategory"
    )
    by_account = await _run(context, "get_spending_summary", period=LAST_MONTH, group_by="account")

    names = {group["name"]: group["amount"]["cents"] for group in by_subcategory.data["groups"]}
    assert names["Alimentação > Mercado"] == 25_000
    assert names["Alimentação > Restaurante"] == 9_000
    assert [(group["name"], group["amount"]["cents"]) for group in by_account.data["groups"]] == [
        ("Conta corrente", 44_000),
        ("Cartão Verde", 40_000),
    ]
    only_card = await _run(
        context, "get_spending_summary", period=LAST_MONTH, account_ids=[finances.card["id"]]
    )
    assert only_card.data["total"]["cents"] == 40_000


async def test_a_period_without_entries_says_so_instead_of_a_number_to_guess(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(
        context, "get_spending_summary", period={"preset": "month", "year": 2026, "month": 1}
    )

    assert result.data["total"]["cents"] == 0
    assert result.data["note"] == "Não há lançamentos nesse período com esses filtros."
    assert (result.transaction_ids, result.transaction_count, result.highlight) == ((), 0, None)
    assert result.summary == (
        "Não há lançamentos de despesas em janeiro de 2026 com esses filtros."
    )


# ---------- get_income_summary


async def test_income_is_the_same_as_the_dashboard_and_leaves_refunds_and_transfers_out(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(
        context, "get_income_summary", period={"preset": "this_year"}, group_by="month"
    )

    trend = await ReportingService(context.session).monthly_trend(
        context.user_id, until=TODAY, months=10
    )
    assert result.data["total"]["cents"] == sum(month.income_cents for month in trend)
    assert result.data["total"]["cents"] == YEAR_INCOME
    assert result.data["period"]["label"] == "janeiro a outubro de 2026"
    assert [group["amount"]["cents"] for group in result.data["groups"]] == [
        month.income_cents for month in trend
    ]
    # Só os dois salários: o estorno da farmácia e a transferência não são receita.
    assert result.transaction_count == 2
    by_category = await _run(
        context, "get_income_summary", period={"preset": "this_year"}, group_by="category"
    )
    assert [(group["name"], group["percent"]) for group in by_category.data["groups"]] == [
        ("Salário", "100,0%")
    ]


# ---------- compare_periods


async def test_compare_periods_brings_difference_and_percent_already_calculated(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(context, "compare_periods", period_a=LAST_MONTH, period_b=IN_AUGUST)

    reports = ReportingService(context.session)
    in_a = (await reports.totals(context.user_id, SEPTEMBER)).expense_cents
    in_b = (await reports.totals(context.user_id, AUGUST)).expense_cents
    assert (in_a, in_b) == (SEPTEMBER_EXPENSES, AUGUST_EXPENSES)
    assert result.data["total"] == {
        "a": money(in_a),
        "b": money(in_b),
        "difference": money(12_500),
        "direction": "aumentou",
        "change_percent": "17,5%",
    }
    groups = {group["name"]: group for group in result.data["groups"]}
    # Da categoria que mais aumentou para a que mais diminuiu.
    assert list(groups) == ["Compras", "Saúde", "Transporte", "Alimentação"]
    assert groups["Compras"]["difference"]["cents"] == 40_000
    # Sem gasto em agosto não há base para o percentual.
    assert "change_percent" not in groups["Compras"]
    assert (groups["Alimentação"]["direction"], groups["Alimentação"]["change_percent"]) == (
        "diminuiu",
        "40,4%",
    )
    assert groups["Alimentação"]["difference"] == money(57_000 - SEPTEMBER_FOOD)
    assert "Compras" in result.summary
    assert result.transaction_count == 8


async def test_compare_periods_without_groups_and_without_increase(
    context: ToolContext, finances: Finances
) -> None:
    totals = await _run(
        context, "compare_periods", period_a=IN_AUGUST, period_b=IN_AUGUST, group_by="none"
    )
    same = await _run(context, "compare_periods", period_a=IN_AUGUST, period_b=IN_AUGUST)

    assert totals.data["total"]["direction"] == "igual"
    assert totals.data["total"]["change_percent"] == "0,0%"
    assert "groups" not in totals.data
    assert same.data["note"] == "Nenhuma categoria teve gasto maior em agosto de 2026."


# ---------- get_top_expenses


async def test_top_expenses_are_the_ones_of_the_dashboard_in_the_same_order(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(context, "get_top_expenses", period=IN_AUGUST, limit=5)

    expected = await ReportingService(context.session).top_expenses(
        context.user_id, AUGUST, limit=5
    )
    assert list(result.transaction_ids) == [expense.id for expense in expected]
    assert [(item["description"], item["amount"]["cents"]) for item in result.data["items"]] == [
        ("Supermercado Bom Preço", 30_000),
        ("Supermercado Bom Preço", 15_000),
        ("Restaurante Sabor", 12_000),
        ("Farmácia Popular", 8_000),
        ("Uber", 4_000),
    ]
    first = result.data["items"][0]
    assert (first["date"], first["category"], first["account"]) == (
        "2026-08-10",
        "Alimentação > Mercado",
        "Conta corrente",
    )
    assert result.summary.startswith("Maiores despesas em agosto de 2026: 1. Supermercado")
    filtered = await _run(
        context, "get_top_expenses", period=IN_AUGUST, category_ids=[finances.transport["id"]]
    )
    assert [item["amount"]["cents"] for item in filtered.data["items"]] == [4_000, 2_500]


# ---------- search_transactions


async def test_search_brings_the_transactions_and_the_sum_of_the_set(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    result = await _run(context, "search_transactions", period=LAST_MONTH, text="farmacia")

    assert {str(item) for item in result.transaction_ids} == await _ids(
        client_a, q="farmacia", **{"from": "2026-09-01", "to": "2026-09-30"}
    )
    assert [(item["description"], item["type"]) for item in result.data["items"]] == [
        ("Estorno Farmácia Popular", "income"),
        ("Farmácia Popular", "expense"),
        ("Farmácia Popular", "expense"),
    ]
    assert result.data["totals"] == {"expenses": money(8_000), "incomes": money(2_000)}
    assert result.data["transaction_count"] == result.transaction_count == 3
    only_expenses = await _run(
        context, "search_transactions", period=LAST_MONTH, text="farmacia", type="expense"
    )
    assert only_expenses.highlight == "R$\N{NO-BREAK SPACE}80,00"


async def test_search_lists_transfers_but_never_sums_them(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(context, "search_transactions", period=LAST_MONTH, type="transfer")

    assert result.transaction_count == 2
    assert result.data["totals"] == {"expenses": money(0), "incomes": money(0)}
    limited = await _run(context, "search_transactions", period=LAST_MONTH, limit=2)
    assert len(limited.data["items"]) == 2
    assert limited.data["note"] == "A lista traz os 2 mais recentes de 11."
    # O que o usuário escreveu chega como dado, dentro do resultado.
    injected = await _run(context, "search_transactions", period=LAST_MONTH, text="ignore")
    assert [item["description"] for item in injected.data["items"]] == [INJECTION]


# ---------- get_account_balances


async def test_balances_are_the_ones_of_the_dashboard(
    context: ToolContext, finances: Finances
) -> None:
    result = await _run(context, "get_account_balances")

    expected = await ReportingService(context.session).account_balances(context.user_id)
    assert [(item["name"], item["balance"]["cents"]) for item in result.data["accounts"]] == [
        (balance.name, balance.balance_cents) for balance in expected
    ]
    savings = await _run(context, "get_account_balances", account_ids=[finances.savings["id"]])
    assert savings.data["accounts"] == [
        {"name": "Poupança", "type": "poupança", "balance": money(700_000)}
    ]
    assert savings.highlight == "R$\N{NO-BREAK SPACE}7.000,00"
    assert savings.summary == "Saldo de hoje: Poupança: R$\N{NO-BREAK SPACE}7.000,00."
    assert (result.highlight, result.transaction_count) == (None, 0)


# ---------- get_card_invoices


async def test_card_invoices_are_the_card_summary_of_the_dashboard(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    result = await _run(context, "get_card_invoices")

    [expected] = await ReportingService(context.session).cards(context.user_id, reference=TODAY)
    [card] = result.data["cards"]
    assert card["name"] == "Cartão Verde"
    assert card["current_invoice"]["amount"] == money(expected.current_invoice.amount_cents)
    assert card["current_invoice"]["amount"]["cents"] == 40_000
    assert card["future_installments"] == {
        "total": money(expected.future_installments.total_cents),
        "months": [
            {"month": "novembro de 2026", "amount": money(40_000)},
            {"month": "dezembro de 2026", "amount": money(40_000)},
        ],
    }
    assert card["total_due"] == money(expected.payment.total_due_cents)
    # As três parcelas: a da fatura aberta e as duas que ainda vêm.
    assert {str(item) for item in result.transaction_ids} == await _ids(
        client_a, account_id=finances.card["id"], period="all"
    )
    assert result.transaction_count == 3


async def test_a_user_without_cards_gets_a_note_and_not_an_error(
    context: ToolContext, client_a: AsyncClient
) -> None:
    await create_account(client_a, name="Conta corrente")

    result = await _run(context, "get_card_invoices")

    assert result.data == {"cards": [], "note": "O usuário não tem cartão de crédito ativo."}


# ---------- parâmetros inválidos e dados de outro usuário


@pytest.mark.parametrize(
    ("name", "arguments", "message"),
    [
        ("get_spending_summary", {}, "period"),
        ("get_spending_summary", {"period": {"preset": "month"}}, "o preset month precisa de"),
        ("get_spending_summary", {"period": THIS_MONTH, "group_by": "week"}, "group_by"),
        (
            "get_spending_summary",
            {"period": THIS_MONTH, "category_ids": ["comida"]},
            "category_ids",
        ),
        ("get_spending_summary", {"period": THIS_MONTH, "user_id": "x"}, "user_id"),
        ("get_top_expenses", {"period": THIS_MONTH, "limit": 99}, "limit"),
        ("search_transactions", {"period": THIS_MONTH, "limit": 0}, "limit"),
        ("get_everything", {}, "não existe"),
    ],
    ids=[
        "sem período",
        "período incompleto",
        "quebra que não existe",
        "id que não é um id",
        "tentativa de dizer o usuário",
        "limite acima do máximo",
        "limite zero",
        "ferramenta que não existe",
    ],
)
async def test_an_invalid_parameter_comes_back_as_a_descriptive_error(
    context: ToolContext, name: str, arguments: dict[str, Any], message: str
) -> None:
    result = await tools.execute(context, name, arguments)

    assert result.is_error
    assert message in result.data["error"]
    assert set(result.data) == {"error"}


async def test_ids_of_another_user_are_treated_as_nonexistent(
    context: ToolContext, finances: Finances, client_b: AsyncClient
) -> None:
    category_of_b = await create_category(client_b, name="Alimentação")
    account_of_b = await create_account(client_b, name="Conta de B")
    unknown = str(uuid.uuid4())

    for name, field, of_other in (
        ("get_spending_summary", "category_ids", category_of_b["id"]),
        ("get_spending_summary", "account_ids", account_of_b["id"]),
        ("get_top_expenses", "category_ids", category_of_b["id"]),
        ("search_transactions", "account_ids", account_of_b["id"]),
    ):
        refused = await tools.execute(context, name, {"period": LAST_MONTH, field: [of_other]})
        missing = await tools.execute(context, name, {"period": LAST_MONTH, field: [unknown]})
        assert refused.is_error and missing.is_error
        # A mesma resposta de um id que não existe, trocado só o id.
        assert refused.data["error"].replace(of_other, unknown) == missing.data["error"]
    for name in ("get_account_balances", "get_card_invoices"):
        refused = await tools.execute(context, name, {"account_ids": [account_of_b["id"]]})
        assert refused.is_error and "não existe" in refused.data["error"]


async def test_the_tools_only_see_the_data_of_the_user_in_the_context(
    session: AsyncSession, finances: Finances, user_b: User
) -> None:
    as_b = ToolContext(session=session, user_id=user_b.id, today=TODAY)

    spending = await _run(as_b, "get_spending_summary", period=LAST_MONTH, group_by="category")
    balances = await _run(as_b, "get_account_balances")
    search = await _run(as_b, "search_transactions", period={"preset": "this_year"})
    top = await _run(as_b, "get_top_expenses", period=LAST_MONTH)
    cards = await _run(as_b, "get_card_invoices")

    assert (spending.data["total"]["cents"], spending.data["groups"]) == (0, [])
    assert balances.data["accounts"] == []
    assert (search.transaction_count, top.data["items"], cards.data["cards"]) == (0, [], [])
    income = await _run(as_b, "get_income_summary", period={"preset": "this_year"})
    assert income.data["total"]["cents"] == 0
    assert (
        await ReportingService(session).amounts(user_b.id, SEPTEMBER, kind=CategoryKind.EXPENSE)
    ).total_cents == 0
