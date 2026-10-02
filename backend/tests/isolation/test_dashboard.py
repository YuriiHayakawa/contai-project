"""Isolamento do painel.

As rotas do painel não recebem identificador de recurso: tudo sai do usuário da sessão. Em cada
caso, o usuário B olha o próprio painel, o usuário A cria uma conta, uma categoria e um
lançamento, e o painel de B continua exatamente igual, sem nenhum número, nome ou identificador
de A. (Os casos rodam em sequência com os mesmos usuários, e outros casos podem ter deixado
dados de B: por isso a comparação é com o antes, e não com zero.)
"""

import uuid
from typing import Any

from tests.finance import create_account, create_category, create_transaction
from tests.isolation.registry import IsolationContext, isolation_case

Json = dict[str, Any]

DASHBOARD = "/api/v1/dashboard"
MONTH = {"month": "2026-10"}


def _unique(name: str) -> str:
    """Os casos rodam em sequência com os mesmos usuários: cada um usa nomes próprios."""
    return f"{name} {uuid.uuid4().hex[:8]}"


async def _finances_of_a(context: IsolationContext) -> tuple[Json, Json, Json]:
    account = await create_account(
        context.client_a, name=_unique("Conta"), initial_balance_cents=123_456
    )
    category = await create_category(context.client_a, name=_unique("Categoria"))
    transaction = await create_transaction(
        context.client_a,
        account,
        category,
        amount_cents=98_765,
        date="2026-10-01",
        description=_unique("Compra"),
    )
    return account, category, transaction


async def _unchanged_for_b(
    context: IsolationContext, path: str, params: dict[str, str]
) -> tuple[Json, Json, Json]:
    """O painel de B antes e depois de A criar dados é o mesmo, e nada de A aparece nele."""
    before = await context.client_b.get(f"{DASHBOARD}/{path}", params=params)
    account, category, transaction = await _finances_of_a(context)
    after = await context.client_b.get(f"{DASHBOARD}/{path}", params=params)

    assert before.status_code == after.status_code == 200
    assert after.json() == before.json()
    for resource in (account, category, transaction):
        assert resource["id"] not in after.text
        assert resource.get("name", resource.get("description")) not in after.text
    return account, category, transaction


@isolation_case("GET", "/api/v1/dashboard/summary")
async def summary(context: IsolationContext) -> None:
    account, _, _ = await _unchanged_for_b(context, "summary", MONTH)

    # O que A criou está lá, para A.
    seen_by_a = (await context.client_a.get(f"{DASHBOARD}/summary", params=MONTH)).json()
    assert seen_by_a["expense_cents"] >= 98_765
    assert account["id"] in [item["id"] for item in seen_by_a["accounts"]]


@isolation_case("GET", "/api/v1/dashboard/categories")
async def categories(context: IsolationContext) -> None:
    _, category, _ = await _unchanged_for_b(context, "categories", MONTH)

    seen_by_a = (await context.client_a.get(f"{DASHBOARD}/categories", params=MONTH)).json()
    assert category["id"] in [item["category_id"] for item in seen_by_a["items"]]


@isolation_case("GET", "/api/v1/dashboard/trend")
async def trend(context: IsolationContext) -> None:
    params = {"until": "2026-10"}
    await _unchanged_for_b(context, "trend", params)

    seen_by_a = (await context.client_a.get(f"{DASHBOARD}/trend", params=params)).json()
    assert seen_by_a["items"][-1]["expense_cents"] >= 98_765


@isolation_case("GET", "/api/v1/dashboard/top-expenses")
async def top_expenses(context: IsolationContext) -> None:
    params = {**MONTH, "limit": "20"}
    _, _, transaction = await _unchanged_for_b(context, "top-expenses", params)

    seen_by_a = (await context.client_a.get(f"{DASHBOARD}/top-expenses", params=params)).json()
    assert transaction["id"] in [item["id"] for item in seen_by_a["items"]]
