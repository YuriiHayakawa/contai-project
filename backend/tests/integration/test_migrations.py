"""As migrações e os modelos precisam descrever o mesmo esquema."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import CheckConstraint, Connection, text
from sqlalchemy.ext.asyncio import AsyncConnection

from app import models_registry  # noqa: F401 - preenche o metadata
from app.core.database import Base


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
    assert not [name for name in in_database if name.count("ck_") > 1]
