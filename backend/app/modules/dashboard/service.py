"""Relatórios: resumo do período, gastos por categoria, evolução por mês e maiores gastos.

O `ReportingService` é a única fonte dos números do painel e do assistente: os dois chamam os
mesmos métodos, e por isso mostram sempre os mesmos valores (FR-062).
"""

import datetime as dt
import re
import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Self

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import ValidationFailed
from app.modules.accounts.service import AccountService
from app.modules.categories.models import Category
from app.modules.categories.repository import CategoryRepository
from app.modules.dashboard.repository import ReportRepository
from app.modules.dashboard.schemas import (
    AccountBalance,
    CategoryBreakdown,
    CategorySpending,
    MonthTotals,
    PeriodTotals,
    SubcategorySpending,
)
from app.modules.transactions.models import TransactionType
from app.modules.transactions.schemas import TransactionRead

INVALID_MONTH = "Escreva o mês como AAAA-MM, por exemplo 2026-10."

_MONTH_PATTERN = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")
# Anos fora desta faixa só aparecem por engano de digitação.
_MIN_YEAR, _MAX_YEAR = 1900, 2200
_ONE_DECIMAL = Decimal("0.1")


@dataclass(frozen=True)
class Period:
    """Intervalo de datas de calendário, com o primeiro e o último dia incluídos."""

    start: dt.date
    end: dt.date

    @classmethod
    def of_month(cls, day: dt.date) -> Self:
        """O mês inteiro de `day`, inclusive os dias que ainda não chegaram."""
        return cls(*clock.month_bounds(day))


def resolve_month(value: str | None, *, field: str = "month") -> dt.date:
    """Primeiro dia do mês pedido (`AAAA-MM`); sem valor, o do mês atual em Brasília (FR-059)."""
    if value is None:
        return clock.today().replace(day=1)
    match = _MONTH_PATTERN.fullmatch(value)
    if match is None or not _MIN_YEAR <= int(match[1]) <= _MAX_YEAR:
        raise ValidationFailed(details={"fields": {field: INVALID_MONTH}})
    return dt.date(int(match[1]), int(match[2]), 1)


def month_label(day: dt.date) -> str:
    """O mês de `day` como aparece nas respostas: `AAAA-MM`."""
    return f"{day.year:04d}-{day.month:02d}"


def _totals(income_cents: int, expense_cents: int) -> dict[str, int]:
    return {
        "income_cents": income_cents,
        "expense_cents": expense_cents,
        "net_cents": income_cents - expense_cents,
    }


def _percent(amount_cents: int, total_cents: int) -> float:
    """Parte do total, de 0 a 100, com uma casa. A conta é decimal; só o resultado vira float."""
    share = (Decimal(amount_cents) * 100 / Decimal(total_cents)).quantize(
        _ONE_DECIMAL, rounding=ROUND_HALF_UP
    )
    return float(share)


def _largest_first(amount_cents: int, name: str) -> tuple[int, str]:
    return -amount_cents, name.casefold()


class ReportingService:
    def __init__(self, session: AsyncSession) -> None:
        self._reports = ReportRepository(session)
        self._categories = CategoryRepository(session)
        self._accounts = AccountService(session)

    async def totals(self, user_id: uuid.UUID, period: Period) -> PeriodTotals:
        """Entradas, saídas e saldo do período; transferências não contam (FR-033)."""
        by_type = await self._reports.totals_by_type(user_id, start=period.start, end=period.end)
        return PeriodTotals(
            **_totals(
                by_type.get(TransactionType.INCOME, 0), by_type.get(TransactionType.EXPENSE, 0)
            )
        )

    async def account_balances(self, user_id: uuid.UUID) -> list[AccountBalance]:
        """Saldo de hoje de cada conta ativa, em ordem alfabética (FR-055)."""
        return [
            AccountBalance(
                id=account.id,
                name=account.name,
                type=account.type,
                balance_cents=account.balance_cents,
            )
            for account in await self._accounts.list(user_id)
        ]

    async def spending_by_category(self, user_id: uuid.UUID, period: Period) -> CategoryBreakdown:
        """Despesas por categoria principal, com as das subcategorias somadas nela (FR-056).

        Uma categoria arquivada continua aparecendo enquanto tiver gasto no período (FR-026).
        """
        amounts = await self._reports.expenses_by_category(
            user_id, start=period.start, end=period.end
        )
        total = sum(amounts.values())
        if total == 0:
            return CategoryBreakdown(total_cents=0, items=[])

        categories = {
            category.id: category
            for category in await self._categories.list_all(user_id, include_archived=True)
        }
        by_parent: dict[uuid.UUID, int] = {}
        children: dict[uuid.UUID, list[tuple[Category, int]]] = {}
        for category_id, amount in amounts.items():
            category = categories[category_id]
            parent_id = category.parent_id or category.id
            by_parent[parent_id] = by_parent.get(parent_id, 0) + amount
            if category.parent_id is not None:
                children.setdefault(parent_id, []).append((category, amount))

        items = [
            CategorySpending(
                category_id=parent_id,
                name=categories[parent_id].name,
                icon=categories[parent_id].icon,
                color=str(categories[parent_id].color),
                amount_cents=amount,
                percent=_percent(amount, total),
                subcategories=[
                    SubcategorySpending(
                        category_id=child.id,
                        name=child.name,
                        icon=child.icon,
                        color=str(child.color),
                        amount_cents=child_amount,
                        percent=_percent(child_amount, total),
                    )
                    for child, child_amount in sorted(
                        children.get(parent_id, []),
                        key=lambda pair: _largest_first(pair[1], pair[0].name),
                    )
                ],
            )
            for parent_id, amount in sorted(
                by_parent.items(),
                key=lambda pair: _largest_first(pair[1], categories[pair[0]].name),
            )
        ]
        return CategoryBreakdown(total_cents=total, items=items)

    async def monthly_trend(
        self, user_id: uuid.UUID, *, until: dt.date, months: int
    ) -> list[MonthTotals]:
        """Entradas e saídas de cada um dos `months` meses que terminam no mês de `until`.

        Do mais antigo para o mais novo; um mês sem lançamentos vem com zeros (FR-057).
        """
        first_days = [
            clock.add_months(until.replace(day=1), -offset) for offset in reversed(range(months))
        ]
        by_month = await self._reports.totals_by_month(
            user_id, start=first_days[0], end=clock.month_bounds(first_days[-1])[1]
        )
        return [
            MonthTotals(
                month=label,
                **_totals(
                    by_month.get((label, TransactionType.INCOME), 0),
                    by_month.get((label, TransactionType.EXPENSE), 0),
                ),
            )
            for label in map(month_label, first_days)
        ]

    async def top_expenses(
        self, user_id: uuid.UUID, period: Period, *, limit: int
    ) -> list[TransactionRead]:
        """As maiores despesas do período, da maior para a menor (FR-057)."""
        transactions = await self._reports.top_expenses(
            user_id, start=period.start, end=period.end, limit=limit
        )
        return [TransactionRead.from_transaction(transaction) for transaction in transactions]
