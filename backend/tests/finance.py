"""Atalhos dos testes de contas, categorias e transações: criam os recursos pela API."""

from typing import Any

from httpx import AsyncClient

ACCOUNTS = "/api/v1/accounts"
CATEGORIES = "/api/v1/categories"
TRANSACTIONS = "/api/v1/transactions"

Json = dict[str, Any]


async def create_account(client: AsyncClient, **fields: object) -> Json:
    payload = {"name": "Conta corrente", "type": "checking", **fields}
    response = await client.post(ACCOUNTS, json=payload)
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


async def create_category(client: AsyncClient, **fields: object) -> Json:
    payload = {
        "name": "Alimentação",
        "kind": "expense",
        "icon": "utensils",
        "color": "caqui",
        **fields,
    }
    response = await client.post(CATEGORIES, json=payload)
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


async def create_transaction(
    client: AsyncClient, account: Json, category: Json, **fields: object
) -> Json:
    payload = {
        "type": category["kind"],
        "amount_cents": 4590,
        "date": "2026-10-01",
        "description": "Padaria São João",
        "account_id": account["id"],
        "category_id": category["id"],
        **fields,
    }
    response = await client.post(TRANSACTIONS, json=payload)
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


async def balance_of(client: AsyncClient, account: Json) -> int:
    response = await client.get(f"{ACCOUNTS}/{account['id']}")
    assert response.status_code == 200, response.text
    balance: int = response.json()["balance_cents"]
    return balance


async def list_transactions(client: AsyncClient, **params: object) -> Json:
    response = await client.get(TRANSACTIONS, params={k: str(v) for k, v in params.items()})
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def descriptions(page: Json) -> list[str]:
    return [item["description"] for item in page["items"]]
