"""`compare_periods`: as despesas de dois períodos lado a lado, com a diferença e a variação
percentual já calculadas. O modelo não faz contas: só copia os valores."""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.assistant.periods import PeriodParam, resolve
from app.modules.assistant.tools.base import (
    MAX_TRANSACTION_IDS,
    ToolContext,
    ToolResult,
    money,
    percent,
    tool,
)
from app.modules.categories.models import CategoryKind
from app.modules.dashboard.service import ReportingService

_ONE_DECIMAL = Decimal("0.1")


class CompareParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period_a: PeriodParam = Field(description="O período em foco, como este mês.")
    period_b: PeriodParam = Field(description="O período de comparação, como o mês passado.")
    group_by: Literal["category", "none"] = Field(
        default="category",
        description="category compara categoria por categoria; none, só o total.",
    )


def _change(a_cents: int, b_cents: int) -> dict[str, Any]:
    """O valor nos dois períodos, quanto mudou de B para A e em que sentido."""
    difference = a_cents - b_cents
    direction = "igual"
    if difference:
        direction = "aumentou" if difference > 0 else "diminuiu"
    change: dict[str, Any] = {
        "a": money(a_cents),
        "b": money(b_cents),
        "difference": money(abs(difference)),
        "direction": direction,
    }
    # Sem gasto em B não há base para um percentual.
    if b_cents > 0:
        share = (Decimal(abs(difference)) * 100 / Decimal(b_cents)).quantize(
            _ONE_DECIMAL, rounding=ROUND_HALF_UP
        )
        change["change_percent"] = percent(share)
    return change


@tool(
    name="compare_periods",
    description=(
        "Compara as despesas de dois períodos: o valor em cada um, a diferença (A menos B), o "
        "sentido (aumentou, diminuiu ou igual) e a variação percentual, já calculados, no "
        "total e por categoria. Use para perguntas como em que gastei mais que no mês passado."
    ),
    params=CompareParams,
)
async def compare_periods(context: ToolContext, params: CompareParams) -> ToolResult:
    period_a = resolve(params.period_a, context.today)
    period_b = resolve(params.period_b, context.today)
    reports = ReportingService(context.session)
    kind = CategoryKind.EXPENSE
    group_by: Literal["category", "none"] = params.group_by
    in_a = await reports.amounts(context.user_id, period_a.period, kind=kind, group_by=group_by)
    in_b = await reports.amounts(context.user_id, period_b.period, kind=kind, group_by=group_by)
    ids, count = await reports.entry_ids(
        context.user_id, period_a.period, kind=kind, limit=MAX_TRANSACTION_IDS
    )

    total = _change(in_a.total_cents, in_b.total_cents)
    data: dict[str, Any] = {
        "period_a": period_a.echo(),
        "period_b": period_b.echo(),
        "total": total,
        "transaction_count_a": count,
    }
    summary = (
        f"Despesas em {period_a.label}: {total['a']['formatted']}; em {period_b.label}: "
        f"{total['b']['formatted']}."
    )
    if params.group_by == "category":
        by_a = {group.name: group.amount_cents for group in in_a.groups}
        by_b = {group.name: group.amount_cents for group in in_b.groups}
        # Da categoria que mais aumentou para a que mais diminuiu.
        names = sorted(
            by_a.keys() | by_b.keys(),
            key=lambda name: (by_b.get(name, 0) - by_a.get(name, 0), name.casefold()),
        )
        groups = [{"name": name, **_change(by_a.get(name, 0), by_b.get(name, 0))} for name in names]
        data["groups"] = groups
        increased = [group for group in groups if group["direction"] == "aumentou"]
        if increased:
            top = increased[0]
            summary += (
                f" A categoria que mais aumentou foi {top['name']}: de {top['b']['formatted']} "
                f"para {top['a']['formatted']}."
            )
        else:
            data["note"] = f"Nenhuma categoria teve gasto maior em {period_a.label}."
            summary += " Nenhuma categoria aumentou."
    return ToolResult(
        data=data, transaction_ids=tuple(ids), transaction_count=count, summary=summary
    )
