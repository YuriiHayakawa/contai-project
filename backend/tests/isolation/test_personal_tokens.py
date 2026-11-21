"""Isolamento dos tokens pessoais e da voz (feature 002, US3).

O usuário B nunca vê, altera nem revoga um token de A, não aponta um token para uma conta de A,
e uma frase dita com o token de B nunca grava na conta de A.
"""

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from app.ai.fake import FakeLLMProvider
from app.modules.categories.service import CategoryService
from app.modules.transactions.models import Transaction
from app.modules.users.models import User
from tests.finance import create_account
from tests.isolation.registry import IsolationContext, isolation_case

TOKENS = "/api/v1/personal-tokens"
VOICE = "/api/v1/voice/entries"

Json = dict[str, Any]


async def _account(client: AsyncClient) -> Json:
    # Os casos rodam com os mesmos dois usuários: cada conta precisa de um nome próprio.
    return await create_account(client, name=f"Conta {uuid.uuid4().hex[:8]}")


async def _token_of(client: AsyncClient, account: Json) -> Json:
    response = await client.post(
        TOKENS, json={"name": "iPhone", "default_account_id": account["id"]}
    )
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


@isolation_case("GET", TOKENS)
async def list_shows_only_own_tokens(context: IsolationContext) -> None:
    await _token_of(context.client_a, await _account(context.client_a))

    listed_by_b = await context.client_b.get(TOKENS)

    assert listed_by_b.status_code == 200
    assert listed_by_b.json()["items"] == []


@isolation_case("POST", TOKENS)
async def a_token_cannot_point_to_another_users_account(context: IsolationContext) -> None:
    account_of_a = await _account(context.client_a)

    created_by_b = await context.client_b.post(
        TOKENS, json={"name": "iPhone", "default_account_id": account_of_a["id"]}
    )

    assert created_by_b.status_code == 422


@isolation_case("PATCH", f"{TOKENS}/{{token_id}}")
async def another_users_token_cannot_be_changed(context: IsolationContext) -> None:
    account_of_a = await _account(context.client_a)
    token_of_a = await _token_of(context.client_a, account_of_a)
    account_of_b = await _account(context.client_b)
    token_of_b = await _token_of(context.client_b, account_of_b)

    changed_by_b = await context.client_b.patch(
        f"{TOKENS}/{token_of_a['id']}", json={"default_account_id": account_of_b["id"]}
    )
    pointed_to_a = await context.client_b.patch(
        f"{TOKENS}/{token_of_b['id']}", json={"default_account_id": account_of_a["id"]}
    )

    assert changed_by_b.status_code == 404
    assert pointed_to_a.status_code == 422
    listed = (await context.client_a.get(TOKENS)).json()["items"]
    [still] = [item for item in listed if item["id"] == token_of_a["id"]]
    assert still["default_account"]["id"] == account_of_a["id"]


@isolation_case("DELETE", f"{TOKENS}/{{token_id}}")
async def another_users_token_cannot_be_revoked(context: IsolationContext) -> None:
    token_of_a = await _token_of(context.client_a, await _account(context.client_a))

    revoked_by_b = await context.client_b.delete(f"{TOKENS}/{token_of_a['id']}")

    assert revoked_by_b.status_code == 404
    listed = (await context.client_a.get(TOKENS)).json()["items"]
    assert token_of_a["id"] in [item["id"] for item in listed]


async def test_a_phrase_with_bs_token_never_saves_in_as_account(
    client: AsyncClient,
    client_a: AsyncClient,
    client_b: AsyncClient,
    user_a: User,
    user_b: User,
    session: Any,
    fake_llm: FakeLLMProvider,
) -> None:
    await CategoryService(session).create_defaults(user_b.id)
    await create_account(client_a, name="Cofrinho da Ana")
    account_of_b = await create_account(client_b, name="Conta do Bruno")
    token_of_b = await _token_of(client_b, account_of_b)
    # B diz o nome da conta de A: ela não é encontrada entre as contas de B.
    fake_llm.queue_structured(
        {
            "intent": "entry",
            "type": "expense",
            "amount": "10",
            "description": "Pão",
            "account_hint": "cofrinho da ana",
        }
    )

    response = await client.post(
        VOICE,
        json={"phrase": "gastei 10 no cofrinho da ana"},
        headers={"Authorization": f"Bearer {token_of_b['token']}"},
    )

    assert response.status_code == 422
    result = await session.execute(select(Transaction).where(Transaction.user_id == user_a.id))
    assert list(result.scalars()) == []
