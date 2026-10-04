"""Consultas agregadas dos relatórios. Todo método exige `user_id`.

Os relatórios leem a tabela de transações e nunca guardam resultado: cada número é calculado na
hora (research.md, seção 17). Só despesas e receitas entram nas somas; transferências ficam de
fora de todas elas (FR-033).

Um estorno é uma receita lançada em categoria de despesa. Ele abate as saídas e o gasto da
categoria dele, e não conta como entrada: comprar e devolver um livro dá zero em Educação.
"""

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    and_,
    case,
    cast,
    func,
    literal_column,
    not_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categories.models import Category, CategoryKind
from app.modules.transactions.models import Transaction, TransactionType
from app.modules.transactions.repository import matches_text

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


@dataclass(frozen=True)
class ReportFilters:
    """Recorte de um relatório, pedido pelo assistente; `None` é "sem este filtro".

    O painel não filtra nada: os relatórios dele são estes mesmos, sem recorte.
    """

    account_ids: Sequence[uuid.UUID] | None = None
    # Já com as subcategorias de cada categoria principal pedida.
    category_ids: Sequence[uuid.UUID] | None = None
    # Trecho da descrição ou da observação, como na busca da lista.
    text: str | None = None
    # O que fica de fora: "quanto gastei sem contar o aluguel?". Com as subcategorias também.
    exclude_category_ids: Sequence[uuid.UUID] | None = None
    exclude_text: str | None = None

    def conditions(self) -> list[ColumnElement[bool]]:
        conditions: list[ColumnElement[bool]] = []
        if self.exclude_category_ids is not None:
            conditions.append(Transaction.category_id.not_in(self.exclude_category_ids))
        if self.exclude_text:
            conditions.append(not_(matches_text(self.exclude_text)))
        if self.account_ids is not None:
            conditions.append(Transaction.account_id.in_(self.account_ids))
        if self.category_ids is not None:
            conditions.append(Transaction.category_id.in_(self.category_ids))
        if self.text:
            conditions.append(matches_text(self.text))
        return conditions


NO_FILTERS = ReportFilters()
Grouping = Literal["category", "account", "month"]
_GROUP_COLUMNS: dict[Grouping, Any] = {
    "category": Transaction.category_id,
    "account": Transaction.account_id,
    "month": _MONTH,
}
_NEWEST_FIRST = (
    Transaction.date.desc(),
    Transaction.created_at.desc(),
    Transaction.id.desc(),
)


class ReportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _entries(
        self,
        user_id: uuid.UUID,
        *,
        start: dt.date,
        end: dt.date,
        kind: CategoryKind,
        filters: ReportFilters,
    ) -> list[ColumnElement[bool]]:
        """As transações que compõem as saídas (`expense`: despesas e estornos) ou as entradas
        (`income`: receitas que não são estorno) de um período e recorte."""
        return [
            Transaction.user_id == user_id,
            Transaction.date >= start,
            Transaction.date <= end,
            Category.kind == kind,
            Transaction.type.in_(_ENTRY_TYPES),
            *filters.conditions(),
        ]

    async def amounts(
        self,
        user_id: uuid.UUID,
        *,
        start: dt.date,
        end: dt.date,
        kind: CategoryKind,
        filters: ReportFilters = NO_FILTERS,
        group: Grouping | None = None,
    ) -> dict[Any, int]:
        """Saídas ou entradas do período e recorte, somadas por grupo.

        A regra é a mesma das somas do painel: o estorno abate as saídas e não conta como
        entrada. Sem `group`, o total vem na chave `None`. Grupo de soma zero não aparece.
        """
        value = _SPENT if kind == CategoryKind.EXPENSE else _RECEIVED
        where = self._entries(user_id, start=start, end=end, kind=kind, filters=filters)
        if group is None:
            result = await self._session.execute(
                select(_sum(value))
                .join(Category, Category.id == Transaction.category_id)
                .where(*where)
            )
            return {None: int(result.scalar_one())}
        column = _GROUP_COLUMNS[group]
        grouped = await self._session.execute(
            select(column, _sum(value))
            .join(Category, Category.id == Transaction.category_id)
            .where(*where)
            .group_by(column)
        )
        return {key: int(amount) for key, amount in grouped.all() if amount != 0}

    async def entry_ids(
        self,
        user_id: uuid.UUID,
        *,
        start: dt.date,
        end: dt.date,
        kind: CategoryKind,
        filters: ReportFilters = NO_FILTERS,
        limit: int,
    ) -> tuple[list[uuid.UUID], int]:
        """Os ids das transações que compõem a soma de `amounts`, da mais nova para a mais
        antiga, até `limit`, e quantas são ao todo (FR-063)."""
        where = self._entries(user_id, start=start, end=end, kind=kind, filters=filters)
        base = select(Transaction.id).join(Category, Category.id == Transaction.category_id)
        ids = await self._session.execute(base.where(*where).order_by(*_NEWEST_FIRST).limit(limit))
        count = await self._session.execute(
            select(func.count())
            .select_from(Transaction)
            .join(Category, Category.id == Transaction.category_id)
            .where(*where)
        )
        return list(ids.scalars()), int(count.scalar_one())

    async def card_entry_ids(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, start: dt.date, limit: int
    ) -> tuple[list[uuid.UUID], int]:
        """As compras e os estornos de um cartão de `start` em diante: a fatura aberta e as
        parcelas que ainda vêm."""
        where = [
            Transaction.user_id == user_id,
            Transaction.account_id == account_id,
            Transaction.date >= start,
            Transaction.type.in_(_ENTRY_TYPES),
        ]
        ids = await self._session.execute(
            select(Transaction.id)
            .where(*where)
            .order_by(Transaction.date, Transaction.id)
            .limit(limit)
        )
        count = await self._session.execute(
            select(func.count()).select_from(Transaction).where(*where)
        )
        return list(ids.scalars()), int(count.scalar_one())

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
        self,
        user_id: uuid.UUID,
        *,
        start: dt.date,
        end: dt.date,
        limit: int,
        filters: ReportFilters = NO_FILTERS,
    ) -> list[Transaction]:
        """As maiores despesas do período e recorte; no empate, a mais recente primeiro."""
        result = await self._session.execute(
            select(Transaction)
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= start,
                Transaction.date <= end,
                Transaction.type == TransactionType.EXPENSE,
                *filters.conditions(),
            )
            .order_by(Transaction.amount_cents.desc(), *_NEWEST_FIRST)
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
