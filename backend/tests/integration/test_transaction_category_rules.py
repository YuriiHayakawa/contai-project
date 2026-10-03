"""A categoria escolhida em um lançamento vira a regra da descrição dele (FR-048).

As ações são feitas pelas rotas de transações; o resultado é lido pelo repositório de
`categorization`, como em contracts/rest-api.md.
"""

import uuid
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categorization.models import CategorizationRule, RuleSource
from app.modules.categorization.repository import CategorizationRepository
from app.modules.users.models import User
from tests.finance import TRANSACTIONS, create_account, create_category, create_transaction

Json = dict[str, Any]

pytestmark = pytest.mark.usefixtures("frozen_time")


@pytest_asyncio.fixture
async def account(client_a: AsyncClient) -> Json:
    return await create_account(client_a)


@pytest_asyncio.fixture
async def food(client_a: AsyncClient) -> Json:
    return await create_category(client_a, name="Alimentação")


@pytest_asyncio.fixture
async def leisure(client_a: AsyncClient) -> Json:
    return await create_category(client_a, name="Lazer", icon="ticket", color="goiaba")


async def _rules(session: AsyncSession, user: User) -> list[tuple[str, str, RuleSource]]:
    """As regras do usuário, relidas do banco: descrição normalizada, categoria e origem."""
    rules: list[CategorizationRule] = await CategorizationRepository(session).list_all(user.id)
    for rule in rules:
        await session.refresh(rule)
    return [
        (rule.description_normalized, str(rule.category_id), RuleSource(rule.source))
        for rule in rules
    ]


async def _patch(client: AsyncClient, transaction: Json, **fields: object) -> Json:
    response = await client.patch(f"{TRANSACTIONS}/{transaction['id']}", json=fields)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def test_creating_a_transaction_saves_the_rule_of_its_normalized_description(
    client_a: AsyncClient, session: AsyncSession, user_a: User, account: Json, food: Json
) -> None:
    await create_transaction(client_a, account, food, description="PAG*Padaria São João 12/05")

    assert await _rules(session, user_a) == [("pag padaria sao joao", food["id"], RuleSource.USER)]


async def test_the_same_description_with_another_category_updates_the_same_rule(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    account: Json,
    food: Json,
    leisure: Json,
) -> None:
    await create_transaction(client_a, account, food, description="Padaria São João")
    # Outra grafia da mesma descrição normalizada.
    await create_transaction(client_a, account, leisure, description="PADARIA SAO JOAO #77")

    assert await _rules(session, user_a) == [("padaria sao joao", leisure["id"], RuleSource.USER)]


async def test_changing_the_category_updates_the_rule(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    account: Json,
    food: Json,
    leisure: Json,
) -> None:
    transaction = await create_transaction(client_a, account, food, description="Cinema")

    await _patch(client_a, transaction, category_id=leisure["id"])

    assert await _rules(session, user_a) == [("cinema", leisure["id"], RuleSource.USER)]


async def test_changing_the_description_saves_the_rule_of_the_new_description(
    client_a: AsyncClient, session: AsyncSession, user_a: User, account: Json, food: Json
) -> None:
    transaction = await create_transaction(client_a, account, food, description="Compra")

    await _patch(client_a, transaction, description="Supermercado Bom Preço")

    # A regra da descrição antiga continua valendo; a da nova entra com a mesma categoria.
    assert await _rules(session, user_a) == [
        ("compra", food["id"], RuleSource.USER),
        ("supermercado bom preco", food["id"], RuleSource.USER),
    ]


async def test_an_edit_that_keeps_category_and_description_does_not_touch_the_rules(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    account: Json,
    food: Json,
    leisure: Json,
) -> None:
    first = await create_transaction(client_a, account, food, description="Padaria")
    # A regra da descrição passa a ser a do lançamento mais novo.
    await create_transaction(client_a, account, leisure, description="Padaria")

    await _patch(client_a, first, amount_cents=999, date="2026-09-30", notes="troco")

    assert await _rules(session, user_a) == [("padaria", leisure["id"], RuleSource.USER)]


async def test_an_ai_rule_becomes_a_user_rule_with_the_new_category(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    account: Json,
    food: Json,
    leisure: Json,
) -> None:
    await CategorizationRepository(session).cache_ai_rule(
        user_a.id, description_normalized="padaria sao joao", category_id=uuid.UUID(leisure["id"])
    )
    await session.commit()

    await create_transaction(client_a, account, food, description="Padaria São João")

    assert await _rules(session, user_a) == [("padaria sao joao", food["id"], RuleSource.USER)]


async def test_the_rules_of_one_user_are_not_read_or_changed_by_another(
    client_a: AsyncClient,
    client_b: AsyncClient,
    session: AsyncSession,
    user_a: User,
    user_b: User,
    account: Json,
    food: Json,
) -> None:
    await create_transaction(client_a, account, food, description="Padaria São João")
    account_of_b = await create_account(client_b)
    category_of_b = await create_category(client_b, name="Mercado")

    await create_transaction(client_b, account_of_b, category_of_b, description="Padaria São João")

    assert await _rules(session, user_a) == [("padaria sao joao", food["id"], RuleSource.USER)]
    assert await _rules(session, user_b) == [
        ("padaria sao joao", category_of_b["id"], RuleSource.USER)
    ]


async def test_a_description_with_only_numbers_saves_no_rule(
    client_a: AsyncClient, session: AsyncSession, user_a: User, account: Json, food: Json
) -> None:
    await create_transaction(client_a, account, food, description="12/05 #4821")

    assert await _rules(session, user_a) == []


async def test_a_transfer_saves_no_rule(
    client_a: AsyncClient, session: AsyncSession, user_a: User, account: Json
) -> None:
    savings = await create_account(client_a, name="Poupança", type="savings")

    response = await client_a.post(
        f"{TRANSACTIONS}/transfers",
        json={
            "from_account_id": account["id"],
            "to_account_id": savings["id"],
            "amount_cents": 50_000,
            "date": "2026-10-01",
            "description": "Guardar dinheiro",
        },
    )

    assert response.status_code == 201, response.text
    assert await _rules(session, user_a) == []
