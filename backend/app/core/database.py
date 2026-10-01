"""Conexão com o banco, base declarativa e sessões."""

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from datetime import datetime
from functools import lru_cache

from sqlalchemy import DateTime, MetaData, func, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKey:
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )


class CreatedAt:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Timestamps(CreatedAt):
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


@lru_cache
def get_engine() -> AsyncEngine:
    return create_async_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Uma unidade de trabalho: confirma ao sair, desfaz se houver erro."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise


SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


async def get_session() -> AsyncIterator[AsyncSession]:
    """Dependência do FastAPI: uma sessão, e uma transação, por requisição."""
    async with session_scope() as session:
        yield session


async def ping(session: AsyncSession) -> bool:
    """Checagem de conexão usada pelo endpoint de saúde."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        return False
    return True
