"""Rotas do painel. Só validam a entrada, chamam o serviço e formatam a resposta.

Todas mostram um mês inteiro, escolhido com `month=AAAA-MM`; sem ele, vale o mês atual no fuso
de Brasília. O painel não aceita intervalo de datas (FR-059).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.dashboard.schemas import (
    DashboardCategories,
    DashboardSummary,
    DashboardTopExpenses,
    DashboardTrend,
)
from app.modules.dashboard.service import Period, ReportingService, month_label, resolve_month

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

DEFAULT_TREND_MONTHS = 6
MAX_TREND_MONTHS = 24
DEFAULT_TOP_EXPENSES = 5
MAX_TOP_EXPENSES = 20

MonthParam = Annotated[
    str | None,
    Query(description="Mês exibido, como `2026-10`. Sem ele, o mês atual em Brasília."),
]


def get_reporting_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReportingService:
    return ReportingService(session)


ReportingServiceDep = Annotated[ReportingService, Depends(get_reporting_service)]


@router.get(
    "/summary",
    summary="Resumo do mês e saldo de cada conta",
    description="Transferências nunca entram em `income_cents` nem em `expense_cents`.",
)
async def get_summary(
    current: CurrentUserDep, service: ReportingServiceDep, month: MonthParam = None
) -> DashboardSummary:
    first_day = resolve_month(month)
    totals = await service.totals(current.id, Period.of_month(first_day))
    return DashboardSummary(
        month=month_label(first_day),
        **totals.model_dump(),
        accounts=await service.account_balances(current.id),
    )


@router.get(
    "/categories",
    summary="Gastos do mês por categoria",
    description="Cada categoria principal traz os gastos das subcategorias somados aos dela.",
)
async def get_categories(
    current: CurrentUserDep, service: ReportingServiceDep, month: MonthParam = None
) -> DashboardCategories:
    first_day = resolve_month(month)
    breakdown = await service.spending_by_category(current.id, Period.of_month(first_day))
    return DashboardCategories(month=month_label(first_day), **breakdown.model_dump())


@router.get("/trend", summary="Entradas e saídas dos últimos meses")
async def get_trend(
    current: CurrentUserDep,
    service: ReportingServiceDep,
    until: Annotated[
        str | None,
        Query(description="Último mês da série, como `2026-10`. Sem ele, vale `month`."),
    ] = None,
    month: MonthParam = None,
    months: Annotated[int, Query(ge=1, le=MAX_TREND_MONTHS)] = DEFAULT_TREND_MONTHS,
) -> DashboardTrend:
    last_month = resolve_month(until, field="until") if until else resolve_month(month)
    return DashboardTrend(
        items=await service.monthly_trend(current.id, until=last_month, months=months)
    )


@router.get("/top-expenses", summary="Maiores despesas do mês")
async def get_top_expenses(
    current: CurrentUserDep,
    service: ReportingServiceDep,
    month: MonthParam = None,
    limit: Annotated[int, Query(ge=1, le=MAX_TOP_EXPENSES)] = DEFAULT_TOP_EXPENSES,
) -> DashboardTopExpenses:
    first_day = resolve_month(month)
    return DashboardTopExpenses(
        month=month_label(first_day),
        items=await service.top_expenses(current.id, Period.of_month(first_day), limit=limit),
    )
