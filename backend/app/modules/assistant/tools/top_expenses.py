"""`get_top_expenses`: as maiores despesas de um período, em ordem, como no painel."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.accounts.repository import AccountRepository
from app.modules.assistant.periods import PeriodParam, resolve
from app.modules.assistant.tools.base import (
    NO_ENTRIES,
    ToolContext,
    ToolResult,
    money,
    report_filters,
    tool,
)
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.service import category_paths
from app.modules.dashboard.service import ReportingService
from app.modules.transactions.schemas import TransactionRead


class TopExpensesParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: PeriodParam
    limit: int = Field(default=5, ge=1, le=20, description="Quantas despesas trazer.")
    category_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Ids de categorias do usuário; a principal inclui as subcategorias.",
    )
    account_ids: list[uuid.UUID] = Field(
        default_factory=list, description="Ids de contas do usuário."
    )


async def describe_transactions(
    context: ToolContext, transactions: list[TransactionRead]
) -> list[dict[str, Any]]:
    """As transações como o modelo as recebe: data, descrição, valor, categoria e conta."""
    categories = {
        category.id: name
        for category, name in category_paths(
            await CategoryRepository(context.session).list_all(
                context.user_id, include_archived=True
            )
        )
    }
    accounts = {
        account.id: account.name
        for account in await AccountRepository(context.session).list_all(
            context.user_id, include_archived=True
        )
    }
    return [
        {
            "date": transaction.date.isoformat(),
            "description": transaction.description,
            "type": str(transaction.type),
            "amount": money(transaction.amount_cents),
            "category": categories.get(transaction.category_id)
            if transaction.category_id
            else None,
            "account": accounts.get(transaction.account_id),
        }
        for transaction in transactions
    ]


@tool(
    name="get_top_expenses",
    description=(
        "As maiores despesas do usuário em um período, da maior para a menor, com filtros "
        "opcionais de categoria e conta. Use para perguntas como quais foram meus 5 maiores "
        "gastos em agosto."
    ),
    params=TopExpensesParams,
)
async def get_top_expenses(context: ToolContext, params: TopExpensesParams) -> ToolResult:
    resolved = resolve(params.period, context.today)
    filters = await report_filters(
        context, category_ids=params.category_ids, account_ids=params.account_ids
    )
    expenses = await ReportingService(context.session).top_expenses(
        context.user_id, resolved.period, limit=params.limit, filters=filters
    )
    items = await describe_transactions(context, expenses)

    data: dict[str, Any] = {"period": resolved.echo(), "items": items}
    if not items:
        data["note"] = NO_ENTRIES
        summary = f"Não há despesas em {resolved.label} com esses filtros."
    else:
        listed = "; ".join(
            f"{position}. {item['description']}: {item['amount']['formatted']}"
            for position, item in enumerate(items, start=1)
        )
        summary = f"Maiores despesas em {resolved.label}: {listed}."
    return ToolResult(
        data=data,
        transaction_ids=tuple(expense.id for expense in expenses),
        transaction_count=len(expenses),
        summary=summary,
    )
