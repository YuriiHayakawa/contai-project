"""As migrações e os modelos precisam descrever o mesmo esquema."""

import datetime as dt
import importlib.util
import re
from pathlib import Path
from types import ModuleType

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import CheckConstraint, Connection, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app import models_registry  # noqa: F401 - preenche o metadata
from app.core.database import Base
from app.modules.accounts.models import AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.users.models import User

VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"

# `ck_users_ck_users_...`: o prefixo da convenção de nomes aplicado duas vezes.
_DOUBLED_PREFIX = re.compile(r"^ck_(\w+?)_ck_\1_")


def _migration(name: str) -> ModuleType:
    """Carrega o arquivo de uma migração: a pasta delas não é um pacote."""
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _diff(sync_connection: Connection) -> list[object]:
    context = MigrationContext.configure(sync_connection)
    return list(compare_metadata(context, Base.metadata))


async def test_migrations_match_models(connection: AsyncConnection) -> None:
    diff = await connection.run_sync(_diff)

    assert diff == []


async def test_core_tables_exist(connection: AsyncConnection) -> None:
    result = await connection.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    )
    tables = {row[0] for row in result}

    assert {
        "users",
        "sessions",
        "email_tokens",
        "login_attempts",
        "jobs",
        "worker_heartbeats",
        "ai_usage",
    } <= tables


async def test_lock_columns_left_the_users_table(connection: AsyncConnection) -> None:
    # O bloqueio é contado por e-mail em `login_attempts`, exista ou não a conta.
    result = await connection.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")
    )
    columns = {row[0] for row in result}

    assert not {"failed_login_count", "locked_until"} & columns


async def test_check_constraints_have_the_names_declared_by_the_models(
    connection: AsyncConnection,
) -> None:
    # Um nome dobrado (`ck_users_ck_users_...`) aparece quando a migração passa o nome
    # completo sem `op.f` e a convenção de nomes o prefixa de novo.
    result = await connection.execute(
        text(
            "SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
            "WHERE c.contype = 'c' AND n.nspname = 'public'"
        )
    )
    in_database = {row[0] for row in result}
    declared = {
        str(constraint.name)
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert in_database == declared
    assert not [name for name in in_database if _DOUBLED_PREFIX.match(name)]


async def test_0007_moves_the_positive_initial_amount_of_a_card_to_its_limit(
    session: AsyncSession, user_a: User
) -> None:
    accounts = AccountRepository(session)
    common = {"institution": None, "initial_balance_date": dt.date(2026, 10, 2)}
    card = {"account_type": AccountType.CREDIT_CARD, "closing_day": 7, "due_day": 7, **common}
    typed_as_limit = await accounts.create(
        user_a.id, name="Inter crédito", initial_balance_cents=0, **card
    )
    in_debt = await accounts.create(user_a.id, name="Cartão", initial_balance_cents=-30_000, **card)
    checking = await accounts.create(
        user_a.id,
        name="Conta",
        account_type=AccountType.CHECKING,
        initial_balance_cents=100_000,
        closing_day=None,
        due_day=None,
        **common,
    )
    # Como era antes da migração: o cartão aceitava valor inicial positivo, e foi nele que um
    # limite de R$ 500,00 acabou digitado. A transação do teste desfaz a troca do esquema.
    await session.execute(
        text("ALTER TABLE accounts DROP CONSTRAINT ck_accounts_card_initial_balance_is_debt")
    )
    await session.execute(
        text("UPDATE accounts SET initial_balance_cents = 50000 WHERE id = :id"),
        {"id": typed_as_limit.id},
    )

    await session.execute(
        text(_migration("0007_card_credit_limit").MOVE_POSITIVE_INITIAL_AMOUNT_TO_LIMIT)
    )

    rows = await session.execute(
        text(
            "SELECT id, initial_balance_cents, credit_limit_cents FROM accounts WHERE user_id = :u"
        ),
        {"u": user_a.id},
    )
    assert {row.id: (row.initial_balance_cents, row.credit_limit_cents) for row in rows} == {
        typed_as_limit.id: (0, 50_000),
        # Dívida inicial e saldo das outras contas não mudam.
        in_debt.id: (-30_000, None),
        checking.id: (100_000, None),
    }
