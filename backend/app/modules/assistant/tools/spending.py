"""`get_spending_summary` e `get_income_summary`: total de despesas ou de receitas de um
período, com um recorte e uma quebra à escolha, sobre o `ReportingService`."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.assistant.periods import PeriodParam, resolve
from app.modules.assistant.tools.base import (
    MAX_TRANSACTION_IDS,
    NO_ENTRIES,
    ToolContext,
    ToolResult,
    money,
    percent,
    plural,
    report_filters,
    tool,
)
from app.modules.categories.models import CategoryKind
from app.modules.dashboard.service import GroupBy, ReportingService

_CATEGORY_IDS = "Ids de categorias do usuário; a categoria principal inclui as subcategorias."
_ACCOUNT_IDS = "Ids de contas do usuário."
_GROUP_BY = (
    "Como quebrar o total: none (só o total), category (categoria principal), subcategory, "
    "account (conta) ou month (mês a mês)."
)


class SpendingParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: PeriodParam
    category_ids: list[uuid.UUID] = Field(default_factory=list, description=_CATEGORY_IDS)
    account_ids: list[uuid.UUID] = Field(default_factory=list, description=_ACCOUNT_IDS)
    description_contains: str | None = Field(
        default=None,
        max_length=100,
        description="Trecho da descrição do lançamento, como o nome de uma loja.",
    )
    group_by: GroupBy = Field(default="none", description=_GROUP_BY)


class IncomeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: PeriodParam
    category_ids: list[uuid.UUID] = Field(default_factory=list, description=_CATEGORY_IDS)
    account_ids: list[uuid.UUID] = Field(default_factory=list, description=_ACCOUNT_IDS)
    group_by: GroupBy = Field(default="none", description=_GROUP_BY)


async def _summary(
    context: ToolContext,
    *,
    kind: CategoryKind,
    noun: Literal["Despesas", "Receitas"],
    period: PeriodParam,
    category_ids: list[uuid.UUID],
    account_ids: list[uuid.UUID],
    text: str | None,
    group_by: GroupBy,
) -> ToolResult:
    resolved = resolve(period, context.today)
    filters = await report_filters(
        context, category_ids=category_ids, account_ids=account_ids, text=text
    )
    reports = ReportingService(context.session)
    breakdown = await reports.amounts(
        context.user_id, resolved.period, kind=kind, filters=filters, group_by=group_by
    )
    ids, count = await reports.entry_ids(
        context.user_id, resolved.period, kind=kind, filters=filters, limit=MAX_TRANSACTION_IDS
    )

    total = money(breakdown.total_cents)
    data: dict[str, object] = {
        "period": resolved.echo(),
        "total": total,
        "transaction_count": count,
    }
    if group_by != "none":
        data["group_by"] = group_by
        data["groups"] = [
            {
                "name": group.name,
                "amount": money(group.amount_cents),
                **({"percent": percent(group.percent)} if group.percent is not None else {}),
            }
            for group in breakdown.groups
        ]
    if count == 0:
        data["note"] = NO_ENTRIES

    summary = f"{noun} em {resolved.label}: {total['formatted']}"
    if count == 0:
        summary = f"Não há lançamentos de {noun.lower()} em {resolved.label} com esses filtros"
    else:
        summary += f", em {plural(count, 'lançamento', 'lançamentos')}"
    return ToolResult(
        data=data,
        transaction_ids=tuple(ids),
        transaction_count=count,
        highlight=total["formatted"] if count else None,
        summary=f"{summary}.",
    )


@tool(
    name="get_spending_summary",
    description=(
        "Total de despesas do usuário em um período, com filtros opcionais de categoria, conta "
        "e trecho da descrição, e a quebra pedida. Estornos abatem o gasto; transferências não "
        "entram. Use para perguntas como quanto gastei com comida este mês."
    ),
    params=SpendingParams,
)
async def get_spending_summary(context: ToolContext, params: SpendingParams) -> ToolResult:
    return await _summary(
        context,
        kind=CategoryKind.EXPENSE,
        noun="Despesas",
        period=params.period,
        category_ids=params.category_ids,
        account_ids=params.account_ids,
        text=params.description_contains,
        group_by=params.group_by,
    )


@tool(
    name="get_income_summary",
    description=(
        "Total de receitas do usuário em um período, com filtros opcionais de categoria e "
        "conta, e a quebra pedida. Estornos e transferências não contam como receita. Use para "
        "perguntas como quanto recebi este ano."
    ),
    params=IncomeParams,
)
async def get_income_summary(context: ToolContext, params: IncomeParams) -> ToolResult:
    return await _summary(
        context,
        kind=CategoryKind.INCOME,
        noun="Receitas",
        period=params.period,
        category_ids=params.category_ids,
        account_ids=params.account_ids,
        text=None,
        group_by=params.group_by,
    )
