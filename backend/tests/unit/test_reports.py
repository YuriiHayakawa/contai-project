"""Relatórios do painel (FR-055 a FR-059): resumo, gastos por categoria, evolução e maiores gastos.

O `ReportingService` é a única fonte desses números, para o painel e para o assistente. As
contas somam centavos inteiros, e transferências nunca entram em receita nem em despesa.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import ValidationFailed
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import Category, CategoryColor, CategoryKind
from app.modules.dashboard.service import (
    Period,
    ReportingService,
    card_reference_date,
    resolve_month,
)
from app.modules.transactions.models import Transaction, TransactionType, TransferDirection
from app.modules.users.models import User

SEPTEMBER = Period(date(2026, 9, 1), date(2026, 9, 30))
OCTOBER = Period(date(2026, 10, 1), date(2026, 10, 31))


async def _account(session: AsyncSession, user: User, name: str = "Conta") -> Account:
    return await AccountRepository(session).create(
        user.id,
        name=name,
        account_type=AccountType.CHECKING,
        institution=None,
        initial_balance_cents=100_000,
        initial_balance_date=date(2026, 1, 1),
        closing_day=None,
        due_day=None,
    )


async def _category(
    session: AsyncSession,
    user: User,
    name: str,
    kind: CategoryKind = CategoryKind.EXPENSE,
    *,
    parent: Category | None = None,
    color: CategoryColor = CategoryColor.CAQUI,
) -> Category:
    category = Category(
        user_id=user.id,
        name=name,
        kind=kind,
        parent_id=parent.id if parent else None,
        icon="shapes",
        color=color,
    )
    session.add(category)
    await session.flush()
    return category


async def _add(
    session: AsyncSession,
    account: Account,
    amount: int,
    on: date,
    *,
    category: Category | None = None,
    direction: TransferDirection | None = None,
    description: str = "Movimento",
) -> Transaction:
    """Grava uma transação direto no banco; com `direction`, é um lado de transferência."""
    transaction = Transaction(
        user_id=account.user_id,
        account_id=account.id,
        type=TransactionType.TRANSFER if category is None else TransactionType(str(category.kind)),
        transfer_direction=direction,
        transfer_group_id=uuid.uuid4() if category is None else None,
        amount_cents=amount,
        date=on,
        description=description,
        description_normalized=description.lower(),
        category_id=category.id if category else None,
        fingerprint="0" * 64,
        # A ordem dos empates é a do lançamento, e o relógio dos testes fica parado.
        created_at=clock.utcnow(),
        updated_at=clock.utcnow(),
    )
    session.add(transaction)
    await session.flush()
    return transaction


@pytest_asyncio.fixture
async def account(session: AsyncSession, user_a: User, frozen_time: datetime) -> Account:
    return await _account(session, user_a)


@pytest_asyncio.fixture
async def food(session: AsyncSession, user_a: User) -> Category:
    return await _category(session, user_a, "Alimentação")


@pytest_asyncio.fixture
async def salary(session: AsyncSession, user_a: User) -> Category:
    return await _category(
        session, user_a, "Salário", CategoryKind.INCOME, color=CategoryColor.MOSTARDA
    )


# ---------- resumo do período


async def test_totals_are_income_expense_and_net_of_the_period(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    await _add(session, account, 350_000, date(2026, 9, 5), category=salary)
    await _add(session, account, 4_590, date(2026, 9, 10), category=food)
    await _add(session, account, 12_345, date(2026, 9, 20), category=food)

    totals = await ReportingService(session).totals(user_a.id, SEPTEMBER)

    assert (totals.income_cents, totals.expense_cents) == (350_000, 16_935)
    assert totals.net_cents == 350_000 - 16_935
    assert all(type(value) is int for value in totals.model_dump().values())


async def test_net_is_negative_when_expenses_exceed_income(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    await _add(session, account, 1_000, date(2026, 9, 5), category=salary)
    await _add(session, account, 2_500, date(2026, 9, 6), category=food)

    totals = await ReportingService(session).totals(user_a.id, SEPTEMBER)

    assert totals.net_cents == -1_500


async def test_first_and_last_day_count_and_the_neighbour_days_do_not(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    await _add(session, account, 1, date(2026, 8, 31), category=food)
    await _add(session, account, 20, date(2026, 9, 1), category=food)
    await _add(session, account, 300, date(2026, 9, 30), category=food)
    await _add(session, account, 4_000, date(2026, 10, 1), category=food)

    totals = await ReportingService(session).totals(user_a.id, SEPTEMBER)

    assert totals.expense_cents == 320


async def test_transfers_never_count_as_income_or_expense(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    savings = await _account(session, user_a, "Poupança")
    await _add(session, account, 200_000, date(2026, 9, 5), category=salary)
    await _add(session, account, 5_000, date(2026, 9, 6), category=food)
    await _add(session, account, 50_000, date(2026, 9, 7), direction=TransferDirection.OUT)
    await _add(session, savings, 50_000, date(2026, 9, 7), direction=TransferDirection.IN)
    reports = ReportingService(session)

    totals = await reports.totals(user_a.id, SEPTEMBER)
    breakdown = await reports.spending_by_category(user_a.id, SEPTEMBER)
    top = await reports.top_expenses(user_a.id, SEPTEMBER, limit=10)
    [month] = await reports.monthly_trend(user_a.id, until=date(2026, 9, 1), months=1)

    assert (totals.income_cents, totals.expense_cents, totals.net_cents) == (
        200_000,
        5_000,
        195_000,
    )
    assert breakdown.total_cents == 5_000
    assert [item.amount_cents for item in top] == [5_000]
    assert (month.income_cents, month.expense_cents) == (200_000, 5_000)


async def test_a_future_date_inside_the_month_counts_in_the_month(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    # Hoje é 1º de outubro: o saldo da conta ignora o dia 20, mas o mês de outubro o inclui,
    # como a lista de lançamentos do mesmo mês.
    await _add(session, account, 9_900, date(2026, 10, 20), category=food)

    totals = await ReportingService(session).totals(user_a.id, OCTOBER)

    assert totals.expense_cents == 9_900


async def test_a_period_without_transactions_is_all_zeros(
    session: AsyncSession, user_a: User, account: Account
) -> None:
    reports = ReportingService(session)

    totals = await reports.totals(user_a.id, SEPTEMBER)
    breakdown = await reports.spending_by_category(user_a.id, SEPTEMBER)

    assert totals.model_dump() == {"income_cents": 0, "expense_cents": 0, "net_cents": 0}
    assert (breakdown.total_cents, breakdown.items) == (0, [])
    assert await reports.top_expenses(user_a.id, SEPTEMBER, limit=5) == []


async def test_sums_are_exact_in_cents(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    for cents in (10, 20, 1, 33, 33, 34):
        await _add(session, account, cents, date(2026, 9, 20), category=food)

    totals = await ReportingService(session).totals(user_a.id, SEPTEMBER)

    assert totals.expense_cents == 131


async def test_another_users_transactions_are_never_counted(
    session: AsyncSession, user_a: User, user_b: User, account: Account, food: Category
) -> None:
    account_of_b = await _account(session, user_b, "Conta de B")
    category_of_b = await _category(session, user_b, "Mercado de B")
    await _add(session, account, 1_000, date(2026, 9, 10), category=food)
    await _add(session, account_of_b, 77_777, date(2026, 9, 10), category=category_of_b)
    reports = ReportingService(session)

    totals = await reports.totals(user_a.id, SEPTEMBER)
    breakdown = await reports.spending_by_category(user_a.id, SEPTEMBER)
    top = await reports.top_expenses(user_a.id, SEPTEMBER, limit=5)

    assert totals.expense_cents == 1_000
    assert [item.name for item in breakdown.items] == ["Alimentação"]
    assert [item.amount_cents for item in top] == [1_000]


# ---------- gastos por categoria


async def test_subcategories_are_added_to_the_parent_with_percentages(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    market = await _category(session, user_a, "Mercado", parent=food)
    delivery = await _category(session, user_a, "Delivery", parent=food)
    transport = await _category(session, user_a, "Transporte", color=CategoryColor.TINTA)
    day = date(2026, 9, 12)
    await _add(session, account, 30_000, day, category=market)
    await _add(session, account, 10_000, day, category=market)
    await _add(session, account, 15_000, day, category=delivery)
    await _add(session, account, 5_000, day, category=food)  # direto na categoria principal
    await _add(session, account, 20_000, day, category=transport)
    await _add(session, account, 500_000, day, category=salary)  # receita não é gasto

    breakdown = await ReportingService(session).spending_by_category(user_a.id, SEPTEMBER)

    assert breakdown.total_cents == 80_000
    assert [(item.name, item.amount_cents, item.percent) for item in breakdown.items] == [
        ("Alimentação", 60_000, 75.0),
        ("Transporte", 20_000, 25.0),
    ]
    food_item, transport_item = breakdown.items
    assert (food_item.category_id, food_item.icon, food_item.color) == (food.id, "shapes", "caqui")
    assert [(sub.name, sub.amount_cents, sub.percent) for sub in food_item.subcategories] == [
        ("Mercado", 40_000, 50.0),
        ("Delivery", 15_000, 18.8),
    ]
    assert transport_item.subcategories == []


async def test_category_total_matches_the_expense_total_of_the_period(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    market = await _category(session, user_a, "Mercado", parent=food)
    other = await _category(session, user_a, "Lazer", color=CategoryColor.GOIABA)
    for amount, category in ((3_333, food), (3_333, market), (3_334, other)):
        await _add(session, account, amount, date(2026, 9, 3), category=category)
    reports = ReportingService(session)

    breakdown = await reports.spending_by_category(user_a.id, SEPTEMBER)
    totals = await reports.totals(user_a.id, SEPTEMBER)

    assert breakdown.total_cents == totals.expense_cents == 10_000
    assert sum(item.amount_cents for item in breakdown.items) == 10_000
    # Um terço e dois terços: o percentual tem uma casa, arredondada.
    assert [(item.name, item.percent) for item in breakdown.items] == [
        ("Alimentação", 66.7),
        ("Lazer", 33.3),
    ]


async def test_categories_are_ordered_by_amount_then_name_and_empty_ones_are_left_out(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    health = await _category(session, user_a, "Saúde", color=CategoryColor.PITANGA)
    leisure = await _category(session, user_a, "Lazer", color=CategoryColor.GOIABA)
    await _category(session, user_a, "Educação", color=CategoryColor.AMEIXA)  # sem gastos
    day = date(2026, 9, 3)
    await _add(session, account, 2_000, day, category=health)
    await _add(session, account, 2_000, day, category=leisure)
    await _add(session, account, 9_000, day, category=food)
    await _add(session, account, 7_000, date(2026, 8, 3), category=health)  # outro mês

    breakdown = await ReportingService(session).spending_by_category(user_a.id, SEPTEMBER)

    assert [item.name for item in breakdown.items] == ["Alimentação", "Lazer", "Saúde"]


async def test_an_archived_category_keeps_its_spending(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    club = await _category(session, user_a, "Clube", color=CategoryColor.AMEIXA)
    await _add(session, account, 12_050, date(2026, 9, 28), category=club)
    club.archived_at = clock.utcnow()
    await session.flush()

    breakdown = await ReportingService(session).spending_by_category(user_a.id, SEPTEMBER)

    assert [(item.name, item.amount_cents) for item in breakdown.items] == [("Clube", 12_050)]


# ---------- evolução por mês


async def test_trend_lists_six_months_in_order_with_empty_months_as_zero(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    await _add(session, account, 1_000, date(2026, 4, 30), category=food)  # antes da janela
    await _add(session, account, 300_000, date(2026, 5, 1), category=salary)
    await _add(session, account, 40_000, date(2026, 5, 31), category=food)
    await _add(session, account, 25_000, date(2026, 8, 15), category=food)
    await _add(session, account, 310_000, date(2026, 10, 5), category=salary)
    await _add(session, account, 9_999, date(2026, 10, 31), category=food)
    await _add(session, account, 5_000, date(2026, 11, 1), category=food)  # depois da janela

    trend = await ReportingService(session).monthly_trend(
        user_a.id, until=date(2026, 10, 1), months=6
    )

    assert [
        (item.month, item.income_cents, item.expense_cents, item.net_cents) for item in trend
    ] == [
        ("2026-05", 300_000, 40_000, 260_000),
        ("2026-06", 0, 0, 0),
        ("2026-07", 0, 0, 0),
        ("2026-08", 0, 25_000, -25_000),
        ("2026-09", 0, 0, 0),
        ("2026-10", 310_000, 9_999, 300_001),
    ]


async def test_trend_crosses_the_year_and_matches_each_months_totals(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    await _add(session, account, 7_700, date(2025, 12, 31), category=food)
    await _add(session, account, 100_000, date(2026, 1, 1), category=salary)
    reports = ReportingService(session)

    trend = await reports.monthly_trend(user_a.id, until=date(2026, 2, 1), months=4)

    assert [item.month for item in trend] == ["2025-11", "2025-12", "2026-01", "2026-02"]
    december = await reports.totals(user_a.id, Period(date(2025, 12, 1), date(2025, 12, 31)))
    assert (trend[1].income_cents, trend[1].expense_cents) == (0, 7_700)
    assert trend[1].model_dump(exclude={"month"}) == december.model_dump()
    assert trend[2].income_cents == 100_000


# ---------- maiores gastos


async def test_top_expenses_are_the_largest_first_up_to_the_limit(
    session: AsyncSession, user_a: User, account: Account, food: Category, salary: Category
) -> None:
    day = date(2026, 9, 10)
    await _add(session, account, 900_000, day, category=salary, description="Salário")
    await _add(session, account, 38_620, day, category=food, description="Mercado Extra")
    await _add(session, account, 4_590, day, category=food, description="iFood")
    await _add(session, account, 120_000, day, category=food, description="Aluguel")
    await _add(session, account, 6_275, day, category=food, description="Farmácia")
    await _add(session, account, 999_999, date(2026, 10, 1), category=food, description="Outubro")

    top = await ReportingService(session).top_expenses(user_a.id, SEPTEMBER, limit=3)

    assert [(item.description, item.amount_cents) for item in top] == [
        ("Aluguel", 120_000),
        ("Mercado Extra", 38_620),
        ("Farmácia", 6_275),
    ]
    assert {item.type for item in top} == {TransactionType.EXPENSE}


async def test_top_expenses_break_ties_by_the_most_recent_date(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    await _add(session, account, 5_000, date(2026, 9, 2), category=food, description="Antiga")
    await _add(session, account, 5_000, date(2026, 9, 25), category=food, description="Recente")

    top = await ReportingService(session).top_expenses(user_a.id, SEPTEMBER, limit=5)

    assert [item.description for item in top] == ["Recente", "Antiga"]


# ---------- saldos das contas


async def test_account_balances_list_only_active_accounts_with_the_computed_balance(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    archived = await _account(session, user_a, "Antiga")
    archived.archived_at = clock.utcnow()
    await _add(session, account, 4_590, date(2026, 9, 10), category=food)
    await _add(session, account, 9_900, date(2026, 10, 20), category=food)  # futura: fora do saldo

    balances = await ReportingService(session).account_balances(user_a.id)

    assert [(item.name, item.type, item.balance_cents) for item in balances] == [
        ("Conta", AccountType.CHECKING, 100_000 - 4_590)
    ]


# ---------- o mês do painel


def test_the_default_month_is_the_current_month_in_sao_paulo(frozen_time: datetime) -> None:
    assert resolve_month(None) == date(2026, 10, 1)


async def test_2330_on_the_last_day_of_the_month_in_sao_paulo_still_counts_in_that_month(
    session: AsyncSession, user_a: User, account: Account, food: Category
) -> None:
    # 23h30 de 30 de setembro em Brasília já é 02h30 de 1º de outubro em UTC.
    clock.set_fixed_time(datetime(2026, 10, 1, 2, 30, tzinfo=UTC))
    await _add(session, account, 4_590, clock.today(), category=food)
    reports = ReportingService(session)

    month = resolve_month(None)
    september = await reports.totals(user_a.id, Period.of_month(month))
    october = await reports.totals(user_a.id, OCTOBER)

    assert month == date(2026, 9, 1)
    assert (september.expense_cents, october.expense_cents) == (4_590, 0)


def test_a_month_is_written_as_year_and_month() -> None:
    assert resolve_month("2026-02") == date(2026, 2, 1)
    assert Period.of_month(date(2028, 2, 1)) == Period(date(2028, 2, 1), date(2028, 2, 29))


@pytest.mark.parametrize(
    "value",
    ["", "2026", "2026-13", "2026-00", "26-10", "2026-1", "2026-10-01", "outubro", "0000-01"],
)
def test_a_month_in_another_format_is_refused_with_a_message(value: str) -> None:
    with pytest.raises(ValidationFailed) as refused:
        resolve_month(value, field="until")

    assert "AAAA-MM" in refused.value.details["fields"]["until"]


def test_card_invoice_is_seen_from_today_or_from_the_edge_of_another_month(
    frozen_time: datetime,
) -> None:
    # Hoje é 1º de outubro de 2026.
    assert card_reference_date(date(2026, 10, 1)) == date(2026, 10, 1)
    assert card_reference_date(date(2026, 2, 1)) == date(2026, 2, 28)
    assert card_reference_date(date(2026, 12, 1)) == date(2026, 12, 1)
