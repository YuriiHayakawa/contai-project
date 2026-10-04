"""`search_transactions`: os lançamentos de um período que atendem a um recorte, e a soma do
conjunto. É a mesma busca da lista de lançamentos."""

import uuid
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.assistant.periods import PeriodParam, resolve
from app.modules.assistant.tools.base import (
    NO_ENTRIES,
    ToolContext,
    ToolResult,
    money,
    plural,
    report_filters,
    tool,
)
from app.modules.assistant.tools.top_expenses import describe_transactions
from app.modules.transactions.models import Transaction, TransactionType
from app.modules.transactions.repository import TransactionFilters, TransactionRepository
from app.modules.transactions.schemas import TransactionRead


class SearchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: PeriodParam
    text: str | None = Field(
        default=None,
        max_length=100,
        description="Trecho da descrição ou da observação, como o nome de uma loja.",
    )
    type: TransactionType | None = Field(
        default=None, description="expense, income ou transfer; sem ele, todos os tipos."
    )
    category_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Ids de categorias do usuário; a principal inclui as subcategorias.",
    )
    account_ids: list[uuid.UUID] = Field(
        default_factory=list, description="Ids de contas do usuário."
    )
    limit: int = Field(default=20, ge=1, le=50, description="Quantos lançamentos trazer.")


@tool(
    name="search_transactions",
    description=(
        "Procura lançamentos do usuário em um período, por trecho da descrição, tipo, categoria "
        "e conta. Devolve os lançamentos, do mais novo para o mais antigo, e a soma das "
        "despesas e das receitas de todos os encontrados. Uma transferência entre contas "
        "aparece uma vez, com a conta de onde saiu e a conta em que entrou, e não entra nas "
        "somas de despesas e receitas. Use para perguntas como mostre minhas compras na "
        "farmácia em setembro ou fiz alguma transferência este mês."
    ),
    params=SearchParams,
)
async def search_transactions(context: ToolContext, params: SearchParams) -> ToolResult:
    resolved = resolve(params.period, context.today)
    recorte = await report_filters(
        context, category_ids=params.category_ids, account_ids=params.account_ids, text=params.text
    )
    filters = TransactionFilters(
        date_from=resolved.start,
        date_to=resolved.end,
        account_ids=list(recorte.account_ids) if recorte.account_ids is not None else None,
        category_ids=list(recorte.category_ids) if recorte.category_ids is not None else None,
        transaction_type=params.type,
        text=recorte.text,
    )
    transactions = TransactionRepository(context.session)
    lines = await transactions.search(context.user_id, filters, limit=params.limit)
    sums = await transactions.totals_by_type(context.user_id, filters)
    moved = await transactions.transfer_totals(context.user_id, filters)
    # As duas linhas de uma transferência, a de saída e a de entrada, são um movimento só:
    # ela aparece e conta uma vez.
    found = _once_per_transfer(lines)
    count = await transactions.count(context.user_id, filters) - moved.lines + moved.count
    expenses = money(sums.get(TransactionType.EXPENSE, 0))
    incomes = money(sums.get(TransactionType.INCOME, 0))
    transfers = money(moved.amount_cents)

    data: dict[str, Any] = {
        "period": resolved.echo(),
        "transaction_count": count,
        "totals": {"expenses": expenses, "incomes": incomes},
        "items": await describe_transactions(
            context,
            [TransactionRead.from_transaction(transaction) for transaction in found],
            await transactions.transfer_accounts(
                context.user_id,
                [line.transfer_group_id for line in found if line.transfer_group_id],
            ),
        ),
    }
    if moved.count:
        data["transfers"] = {"count": moved.count, "total": transfers}
    if count > len(found):
        data["note"] = f"A lista traz os {len(found)} mais recentes de {count}."
    if count == 0:
        data["note"] = NO_ENTRIES
        summary = f"Não há lançamentos em {resolved.label} com esses filtros."
    else:
        summary = (
            f"Encontrei {plural(count, 'lançamento', 'lançamentos')} em {resolved.label}: "
            f"despesas de {expenses['formatted']} e receitas de {incomes['formatted']}"
        )
        if moved.count:
            summary += (
                f", e {plural(moved.count, 'transferência', 'transferências')} entre contas, "
                f"no total de {transfers['formatted']}"
            )
        summary += "."
    spent, received = sums.get(TransactionType.EXPENSE, 0), sums.get(TransactionType.INCOME, 0)
    highlight = None
    if spent and not received:
        highlight = expenses["formatted"]
    elif moved.count and not spent and not received:
        highlight = transfers["formatted"]
    return ToolResult(
        data=data,
        transaction_ids=tuple(transaction.id for transaction in found),
        transaction_count=count,
        highlight=highlight,
        summary=summary,
    )


def _once_per_transfer(lines: Sequence[Transaction]) -> list[Transaction]:
    """Os lançamentos na mesma ordem, com cada transferência só na primeira linha dela."""
    seen: set[uuid.UUID] = set()
    kept: list[Transaction] = []
    for line in lines:
        if line.transfer_group_id is not None:
            if line.transfer_group_id in seen:
                continue
            seen.add(line.transfer_group_id)
        kept.append(line)
    return kept
