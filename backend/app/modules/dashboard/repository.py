"""Consultas agregadas dos relatórios. Todo método exige `user_id`.

Os relatórios leem a tabela de transações e nunca guardam resultado: cada número é calculado na
hora (research.md, seção 17). Só despesas e receitas entram nas somas; transferências ficam de
fora de todas elas (FR-033).
"""

import datetime as dt
import uuid

from sqlalchemy import BigInteger, cast, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Transaction, TransactionType

_ENTRY_TYPES = (TransactionType.INCOME, TransactionType.EXPENSE)
_TOTAL = cast(func.coalesce(func.sum(Transaction.amount_cents), 0), BigInteger)
# O formato vai escrito na consulta, e não como parâmetro: com parâmetro, o banco não reconhece
# a expressão do `GROUP BY` como a mesma do `SELECT`.
_MONTH = func.to_char(Transaction.date, literal_column("'YYYY-MM'"))


class ReportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def totals_by_type(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[TransactionType, int]:
        """Soma de receitas e de despesas com data entre `start` e `end`, inclusive."""
        result = await self._session.execute(
            select(Transaction.type, _TOTAL)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type.in_(_ENTRY_TYPES),
            )
            .group_by(Transaction.type)
        )
        return {TransactionType(kind): int(amount) for kind, amount in result.all()}

    async def totals_by_month(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[tuple[str, TransactionType], int]:
        """Soma de receitas e de despesas por mês (`AAAA-MM`). Mês sem transações não aparece."""
        result = await self._session.execute(
            select(_MONTH, Transaction.type, _TOTAL)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type.in_(_ENTRY_TYPES),
            )
            .group_by(_MONTH, Transaction.type)
        )
        return {(month, TransactionType(kind)): int(amount) for month, kind, amount in result.all()}

    async def expenses_by_category(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[uuid.UUID, int]:
        """Soma das despesas de cada categoria, sem juntar subcategoria com a principal."""
        result = await self._session.execute(
            select(Transaction.category_id, _TOTAL)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type == TransactionType.EXPENSE,
            )
            .group_by(Transaction.category_id)
        )
        # Toda despesa tem categoria: o banco garante (só transferência fica sem).
        return {
            category_id: int(amount)
            for category_id, amount in result.all()
            if category_id is not None
        }

    async def top_expenses(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date, limit: int
    ) -> list[Transaction]:
        """As maiores despesas do período; no empate, a mais recente primeiro."""
        result = await self._session.execute(
            select(Transaction)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type == TransactionType.EXPENSE,
            )
            .order_by(
                Transaction.amount_cents.desc(),
                Transaction.date.desc(),
                Transaction.created_at.desc(),
                Transaction.id.desc(),
            )
            .limit(limit)
        )
        return list(result.scalars())
