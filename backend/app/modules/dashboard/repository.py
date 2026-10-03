"""Consultas agregadas dos relatórios. Todo método exige `user_id`.

Os relatórios leem a tabela de transações e nunca guardam resultado: cada número é calculado na
hora (research.md, seção 17). Só despesas e receitas entram nas somas; transferências ficam de
fora de todas elas (FR-033).

Um estorno é uma receita lançada em categoria de despesa. Ele abate as saídas e o gasto da
categoria dele, e não conta como entrada: comprar e devolver um livro dá zero em Educação.
"""

import datetime as dt
import uuid

from sqlalchemy import BigInteger, ColumnElement, and_, case, cast, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categories.models import Category, CategoryKind
from app.modules.transactions.models import Transaction, TransactionType

_ENTRY_TYPES = (TransactionType.INCOME, TransactionType.EXPENSE)


def _sum(amount: ColumnElement[int]) -> ColumnElement[int]:
    return cast(func.coalesce(func.sum(amount), 0), BigInteger)


_TOTAL = cast(func.coalesce(func.sum(Transaction.amount_cents), 0), BigInteger)
# As somas abaixo leem o tipo da categoria: a consulta precisa do `JOIN` com `categories`.
_IS_REFUND = and_(Transaction.type == TransactionType.INCOME, Category.kind == CategoryKind.EXPENSE)
# Saídas: as despesas menos os estornos.
_SPENT = case(
    (Transaction.type == TransactionType.EXPENSE, Transaction.amount_cents),
    (_IS_REFUND, -Transaction.amount_cents),
    else_=0,
)
# Entradas: as receitas que não são estorno.
_RECEIVED = case(
    (
        and_(Transaction.type == TransactionType.INCOME, Category.kind == CategoryKind.INCOME),
        Transaction.amount_cents,
    ),
    else_=0,
)
# O formato vai escrito na consulta, e não como parâmetro: com parâmetro, o banco não reconhece
# a expressão do `GROUP BY` como a mesma do `SELECT`.
_MONTH = func.to_char(Transaction.date, literal_column("'YYYY-MM'"))


class ReportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def totals_by_type(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[TransactionType, int]:
        """Entradas e saídas com data entre `start` e `end`, inclusive.

        O estorno abate as saídas, e não soma nas entradas.
        """
        result = await self._session.execute(
            select(_sum(_RECEIVED), _sum(_SPENT))
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type.in_(_ENTRY_TYPES),
            )
        )
        received, spent = result.one()
        return {TransactionType.INCOME: int(received), TransactionType.EXPENSE: int(spent)}

    async def totals_by_month(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[tuple[str, TransactionType], int]:
        """Entradas e saídas por mês (`AAAA-MM`), com o estorno abatendo as saídas do mês
        dele. Mês sem transações não aparece."""
        result = await self._session.execute(
            select(_MONTH, _sum(_RECEIVED), _sum(_SPENT))
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type.in_(_ENTRY_TYPES),
            )
            .group_by(_MONTH)
        )
        totals: dict[tuple[str, TransactionType], int] = {}
        for month, received, spent in result.all():
            totals[month, TransactionType.INCOME] = int(received)
            totals[month, TransactionType.EXPENSE] = int(spent)
        return totals

    async def expenses_by_category(
        self, user_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[uuid.UUID, int]:
        """Gasto de cada categoria, sem juntar subcategoria com a principal: as despesas menos
        os estornos.

        O valor fica negativo quando o estorno cai em um mês e a compra, em outro. A categoria em
        que os dois se anulam não aparece.
        """
        result = await self._session.execute(
            select(Transaction.category_id, _sum(_SPENT))
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Category.kind == CategoryKind.EXPENSE,
                Transaction.type.in_(_ENTRY_TYPES),
            )
            .group_by(Transaction.category_id)
        )
        return {
            category_id: int(amount)
            for category_id, amount in result.all()
            if category_id is not None and amount != 0
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

    async def account_totals_by_type(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, start: dt.date, end: dt.date
    ) -> dict[TransactionType, int]:
        """Soma de receitas e de despesas de uma conta no período, inclusive."""
        result = await self._session.execute(
            select(Transaction.type, _TOTAL)
            .where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type.in_(_ENTRY_TYPES),
            )
            .group_by(Transaction.type)
        )
        return {TransactionType(kind): int(amount) for kind, amount in result.all()}

    async def installments_from(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, start: dt.date
    ) -> list[tuple[dt.date, int]]:
        """Data e valor das parcelas de compras parceladas do cartão a partir de `start`."""
        result = await self._session.execute(
            select(Transaction.date, Transaction.amount_cents)
            .where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                Transaction.date >= start,
                Transaction.type == TransactionType.EXPENSE,
                Transaction.installment_group_id.is_not(None),
            )
            .order_by(Transaction.date)
        )
        return [(day, int(amount)) for day, amount in result.all()]
