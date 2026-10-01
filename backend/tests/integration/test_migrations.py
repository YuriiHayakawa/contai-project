"""As migrações e os modelos precisam descrever o mesmo esquema."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection, text
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

    assert {"users", "sessions", "email_tokens", "jobs", "worker_heartbeats", "ai_usage"} <= tables
