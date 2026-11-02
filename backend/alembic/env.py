"""Ambiente do Alembic, em modo assíncrono.

O endereço do banco vem das configurações da aplicação. O metadata inclui os modelos de todos
os módulos, importados por `app.models_registry`.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app import models_registry  # noqa: F401 - importa os modelos para preencher o metadata
from app.core.config import get_settings
from app.core.database import Base

config = context.config

# Pela linha de comando, o log segue o alembic.ini. Quem chama as migrações de dentro de um
# processo que já configurou o próprio log (os testes) desliga isso, senão o alembic.ini troca o
# nível e a saída do log de todo o processo.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    # Os testes informam o banco pelo atributo "sqlalchemy.url"; fora deles vale o da aplicação.
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    connectable = async_engine_from_config(
        {"sqlalchemy.url": _database_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
