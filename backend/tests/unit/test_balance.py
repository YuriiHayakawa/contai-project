"""Saldo de conta (FR-023).

Saldo = saldo inicial, mais receitas, menos despesas, mais transferências recebidas e menos
transferências enviadas, contando só as transações com data entre a data de referência do
saldo inicial (inclusive) e hoje (inclusive), no fuso de Brasília.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.accounts.service import AccountService
from app.modules.categories.models import Category, CategoryColor, CategoryKind
from app.modules.transactions.models import Transaction, TransactionType, TransferDirection
from app.modules.users.models import User

REFERENCE = date(2026, 9, 10)
TODAY = date(2026, 10, 1)  # o dia de `frozen_time` em Brasília
INITIAL = 100_000


async def _account(
    session: AsyncSession, user: User, name: str = "Conta", initial: int = INITIAL
) -> Account:
    return await AccountRepository(session).create(
        user.id,
        name=name,
        account_type=AccountType.CHECKING,
        institution=None,
        initial_balance_cents=initial,
        initial_balance_date=REFERENCE,
        closing_day=None,
        due_day=None,
    )


async def _category(session: AsyncSession, user: User, kind: CategoryKind) -> Category:
    category = Category(
        user_id=user.id,
        name=f"Categoria {kind}",
        kind=kind,
        icon="shapes",
        color=CategoryColor.TINTA,
    )
    session.add(category)
    await session.flush()
    return category


@pytest_asyncio.fixture
async def account(session: AsyncSession, user_a: User) -> Account:
    return await _account(session, user_a)


@pytest_asyncio.fixture
async def categories(session: AsyncSession, user_a: User) -> dict[TransactionType, Category]:
    return {
        TransactionType.EXPENSE: await _category(session, user_a, CategoryKind.EXPENSE),
        TransactionType.INCOME: await _category(session, user_a, CategoryKind.INCOME),
    }


async def _add(
    session: AsyncSession,
    account: Account,
    amount: int,
    on: date,
    *,
    category: Category | None = None,
    direction: TransferDirection | None = None,
) -> None:
    """Grava uma transação direto no banco; com `direction`, é um lado de transferência."""
    is_transfer = direction is not None
    kind = TransactionType.TRANSFER if is_transfer else TransactionType(str(category.kind))  # type: ignore[union-attr]
    session.add(
        Transaction(
            user_id=account.user_id,
            account_id=account.id,
            type=kind,
            transfer_direction=direction,
            transfer_group_id=uuid.uuid4() if is_transfer else None,
            amount_cents=amount,
            date=on,
            description="Movimento",
            description_normalized="movimento",
            category_id=None if is_transfer else category.id,  # type: ignore[union-attr]
            fingerprint="0" * 64,
        )
    )
    await session.flush()


async def _balance(session: AsyncSession, account: Account) -> int:
    return (await AccountService(session).get(account.user_id, account.id)).balance_cents


async def test_account_without_transactions_has_the_initial_balance(
    session: AsyncSession, account: Account, frozen_time: datetime
) -> None:
    assert await _balance(session, account) == INITIAL


async def test_balance_adds_income_and_incoming_transfers_and_subtracts_the_rest(
    session: AsyncSession,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    day = date(2026, 9, 20)
    await _add(session, account, 250_000, day, category=categories[TransactionType.INCOME])
    await _add(session, account, 4_590, day, category=categories[TransactionType.EXPENSE])
    await _add(session, account, 12_345, day, category=categories[TransactionType.EXPENSE])
    await _add(session, account, 30_000, day, direction=TransferDirection.IN)
    await _add(session, account, 80_001, day, direction=TransferDirection.OUT)

    balance = await _balance(session, account)

    assert balance == INITIAL + 250_000 - 4_590 - 12_345 + 30_000 - 80_001
    assert type(balance) is int


async def test_the_reference_date_itself_counts_and_the_day_before_does_not(
    session: AsyncSession,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    expense = categories[TransactionType.EXPENSE]
    await _add(session, account, 1_000, REFERENCE, category=expense)
    await _add(session, account, 70_000, REFERENCE - timedelta(days=1), category=expense)
    await _add(session, account, 90_000, date(2020, 1, 1), category=expense)
    await _add(
        session, account, 5_000, REFERENCE - timedelta(days=1), direction=TransferDirection.IN
    )

    # Só a transação do próprio dia de referência entra; as anteriores já estão no saldo inicial.
    assert await _balance(session, account) == INITIAL - 1_000


async def test_today_counts_and_future_transactions_do_not(
    session: AsyncSession,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    income = categories[TransactionType.INCOME]
    await _add(session, account, 2_000, TODAY, category=income)
    await _add(session, account, 300_000, TODAY + timedelta(days=1), category=income)
    await _add(
        session, account, 10_000, TODAY + timedelta(days=40), direction=TransferDirection.OUT
    )

    assert await _balance(session, account) == INITIAL + 2_000


async def test_today_is_the_day_in_sao_paulo(
    session: AsyncSession, account: Account, categories: dict[TransactionType, Category]
) -> None:
    await _add(
        session, account, 500, date(2026, 10, 2), category=categories[TransactionType.EXPENSE]
    )
    try:
        # 01:00 UTC de 2 de outubro ainda é 1º de outubro em Brasília: a transação é futura.
        clock.set_fixed_time(datetime(2026, 10, 2, 1, 0, tzinfo=UTC))
        still_yesterday = await _balance(session, account)
        clock.set_fixed_time(datetime(2026, 10, 2, 3, 0, tzinfo=UTC))
        now_today = await _balance(session, account)
    finally:
        clock.set_fixed_time(None)

    assert (still_yesterday, now_today) == (INITIAL, INITIAL - 500)


async def test_moving_the_reference_date_changes_which_transactions_count(
    session: AsyncSession,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    expense = categories[TransactionType.EXPENSE]
    await _add(session, account, 1_000, date(2026, 9, 5), category=expense)
    await _add(session, account, 2_000, date(2026, 9, 15), category=expense)
    await _add(session, account, 4_000, date(2026, 9, 25), category=expense)
    assert await _balance(session, account) == INITIAL - 6_000

    account.initial_balance_date = date(2026, 9, 1)
    await session.flush()
    assert await _balance(session, account) == INITIAL - 7_000

    account.initial_balance_date = date(2026, 9, 20)
    await session.flush()
    assert await _balance(session, account) == INITIAL - 4_000

    # Uma data de referência no futuro deixa só o saldo inicial.
    account.initial_balance_date = TODAY + timedelta(days=10)
    await session.flush()
    assert await _balance(session, account) == INITIAL


async def test_each_account_counts_only_its_own_transactions(
    session: AsyncSession,
    user_a: User,
    user_b: User,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    other = await _account(session, user_a, "Poupança", initial=-3_000)
    of_b = await _account(session, user_b, "Conta de B", initial=0)
    category_of_b = await _category(session, user_b, CategoryKind.INCOME)
    day = date(2026, 9, 20)
    await _add(session, account, 1_500, day, category=categories[TransactionType.EXPENSE])
    await _add(session, other, 9_999, day, category=categories[TransactionType.INCOME])
    await _add(session, of_b, 77_777, day, category=category_of_b)

    balances = {
        item.name: item.balance_cents for item in await AccountService(session).list(user_a.id)
    }

    assert balances == {"Conta": INITIAL - 1_500, "Poupança": -3_000 + 9_999}
    assert await _balance(session, of_b) == 77_777


async def test_sums_are_exact_in_cents(
    session: AsyncSession,
    account: Account,
    categories: dict[TransactionType, Category],
    frozen_time: datetime,
) -> None:
    # 0,10 + 0,20 em ponto flutuante não dá 0,30; em centavos inteiros, dá.
    expense = categories[TransactionType.EXPENSE]
    for cents in (10, 20, 1, 33, 33, 34):
        await _add(session, account, cents, date(2026, 9, 20), category=expense)

    assert await _balance(session, account) == INITIAL - 131
