"""Isolamento de contas, categorias e transações.

Em cada caso, o usuário A cria o recurso e o usuário B tenta alcançá-lo: pelo endereço, recebe
404, igual ao de um recurso que não existe; como referência no corpo de um pedido (a conta ou a
categoria de uma transação), recebe a recusa de um valor inválido. Nada de A muda.
"""

import uuid
from typing import Any

from httpx import AsyncClient, Response

from tests.finance import (
    ACCOUNTS,
    CATEGORIES,
    TRANSACTIONS,
    create_account,
    create_category,
    create_transaction,
)
from tests.isolation.registry import IsolationContext, exempt, isolation_case

Json = dict[str, Any]


def _unique(name: str) -> str:
    """Os casos rodam em sequência com os mesmos usuários: cada um usa nomes próprios."""
    return f"{name} {uuid.uuid4().hex[:8]}"


async def _account_of_a(context: IsolationContext) -> Json:
    return await create_account(context.client_a, name=_unique("Conta"))


async def _category_of_a(context: IsolationContext, **fields: object) -> Json:
    return await create_category(context.client_a, name=_unique("Categoria"), **fields)


async def _transaction_of_a(context: IsolationContext) -> tuple[Json, Json, Json]:
    account = await _account_of_a(context)
    category = await _category_of_a(context)
    transaction = await create_transaction(context.client_a, account, category)
    return account, category, transaction


async def _same_as_unknown(client: AsyncClient, method: str, url: str, **kwargs: Any) -> None:
    """A resposta para o recurso de outro usuário é a mesma de um recurso inexistente."""
    unknown_url = url.replace(url.split("/")[4], str(uuid.uuid4()))
    of_other: Response = await client.request(method, url, **kwargs)
    unknown: Response = await client.request(method, unknown_url, **kwargs)

    assert of_other.status_code == 404, of_other.text
    assert unknown.status_code == 404
    assert of_other.json()["error"] == unknown.json()["error"]


# ---------- contas

exempt(
    "POST", "/api/v1/accounts", "cria uma conta do próprio usuário; não referencia outro recurso"
)


@isolation_case("GET", "/api/v1/accounts")
async def list_accounts(context: IsolationContext) -> None:
    account = await _account_of_a(context)

    seen_by_b = await context.client_b.get(ACCOUNTS, params={"include_archived": "true"})

    assert account["id"] not in seen_by_b.text
    assert account["name"] not in seen_by_b.text


@isolation_case("GET", "/api/v1/accounts/{account_id}")
async def get_account(context: IsolationContext) -> None:
    account = await _account_of_a(context)

    await _same_as_unknown(context.client_b, "GET", f"{ACCOUNTS}/{account['id']}")


@isolation_case("PATCH", "/api/v1/accounts/{account_id}")
async def update_account(context: IsolationContext) -> None:
    account = await _account_of_a(context)

    await _same_as_unknown(
        context.client_b, "PATCH", f"{ACCOUNTS}/{account['id']}", json={"name": "Invadida"}
    )
    assert (await context.client_a.get(f"{ACCOUNTS}/{account['id']}")).json() == account


@isolation_case("DELETE", "/api/v1/accounts/{account_id}")
async def delete_account(context: IsolationContext) -> None:
    account = await _account_of_a(context)

    await _same_as_unknown(context.client_b, "DELETE", f"{ACCOUNTS}/{account['id']}")
    assert (await context.client_a.get(f"{ACCOUNTS}/{account['id']}")).status_code == 200


@isolation_case("POST", "/api/v1/accounts/{account_id}/archive")
async def archive_account(context: IsolationContext) -> None:
    account = await _account_of_a(context)

    await _same_as_unknown(context.client_b, "POST", f"{ACCOUNTS}/{account['id']}/archive")
    assert (await context.client_a.get(f"{ACCOUNTS}/{account['id']}")).json()["archived"] is False


@isolation_case("POST", "/api/v1/accounts/{account_id}/unarchive")
async def unarchive_account(context: IsolationContext) -> None:
    account = await _account_of_a(context)
    await context.client_a.post(f"{ACCOUNTS}/{account['id']}/archive")

    await _same_as_unknown(context.client_b, "POST", f"{ACCOUNTS}/{account['id']}/unarchive")
    assert (await context.client_a.get(f"{ACCOUNTS}/{account['id']}")).json()["archived"] is True


# ---------- categorias


@isolation_case("GET", "/api/v1/categories")
async def list_categories(context: IsolationContext) -> None:
    category = await _category_of_a(context)

    seen_by_b = await context.client_b.get(CATEGORIES, params={"include_archived": "true"})

    assert category["id"] not in seen_by_b.text
    assert category["name"] not in seen_by_b.text


@isolation_case("POST", "/api/v1/categories")
async def create_subcategory_under_another_users_category(context: IsolationContext) -> None:
    parent = await _category_of_a(context)

    response = await context.client_b.post(
        CATEGORIES,
        json={
            "name": "Intrusa",
            "kind": "expense",
            "parent_id": parent["id"],
            "icon": "shapes",
            "color": "mata",
        },
    )

    assert response.status_code == 422
    assert "parent_id" in response.json()["error"]["details"]["fields"]
    tree_of_a = await context.client_a.get(CATEGORIES)
    assert "Intrusa" not in tree_of_a.text


@isolation_case("PATCH", "/api/v1/categories/{category_id}")
async def update_category(context: IsolationContext) -> None:
    category = await _category_of_a(context)

    await _same_as_unknown(
        context.client_b, "PATCH", f"{CATEGORIES}/{category['id']}", json={"name": "Invadida"}
    )
    assert category["name"] in (await context.client_a.get(CATEGORIES)).text


@isolation_case("POST", "/api/v1/categories/{category_id}/archive")
async def archive_category(context: IsolationContext) -> None:
    category = await _category_of_a(context)

    await _same_as_unknown(context.client_b, "POST", f"{CATEGORIES}/{category['id']}/archive")
    assert category["id"] in (await context.client_a.get(CATEGORIES)).text


@isolation_case("POST", "/api/v1/categories/{category_id}/unarchive")
async def unarchive_category(context: IsolationContext) -> None:
    category = await _category_of_a(context)
    await context.client_a.post(f"{CATEGORIES}/{category['id']}/archive")

    await _same_as_unknown(context.client_b, "POST", f"{CATEGORIES}/{category['id']}/unarchive")
    assert category["id"] not in (await context.client_a.get(CATEGORIES)).text


# ---------- transações


@isolation_case("GET", "/api/v1/transactions")
async def list_transactions(context: IsolationContext) -> None:
    account, category, transaction = await _transaction_of_a(context)

    everything = await context.client_b.get(TRANSACTIONS)
    # Nem pedindo pelos identificadores do outro usuário.
    by_account = await context.client_b.get(TRANSACTIONS, params={"account_id": account["id"]})
    by_category = await context.client_b.get(TRANSACTIONS, params={"category_id": category["id"]})
    by_id = await context.client_b.get(TRANSACTIONS, params={"ids": transaction["id"]})

    for response in (everything, by_account, by_category, by_id):
        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None, "total_count": 0}


@isolation_case("POST", "/api/v1/transactions")
async def create_transaction_in_another_users_account_or_category(
    context: IsolationContext,
) -> None:
    account_of_a, category_of_a, _ = await _transaction_of_a(context)
    account_of_b = await create_account(context.client_b, name=_unique("Conta de B"))
    category_of_b = await create_category(context.client_b, name=_unique("Categoria de B"))
    payload = {
        "type": "expense",
        "amount_cents": 999,
        "date": "2026-10-01",
        "description": "Intrusa",
    }

    in_account_of_a = await context.client_b.post(
        TRANSACTIONS,
        json={**payload, "account_id": account_of_a["id"], "category_id": category_of_b["id"]},
    )
    in_category_of_a = await context.client_b.post(
        TRANSACTIONS,
        json={**payload, "account_id": account_of_b["id"], "category_id": category_of_a["id"]},
    )
    unknown_account = await context.client_b.post(
        TRANSACTIONS,
        json={**payload, "account_id": str(uuid.uuid4()), "category_id": category_of_b["id"]},
    )

    assert in_account_of_a.status_code == in_category_of_a.status_code == 422
    assert "account_id" in in_account_of_a.json()["error"]["details"]["fields"]
    assert "category_id" in in_category_of_a.json()["error"]["details"]["fields"]
    # A conta de outro usuário é recusada do mesmo jeito que uma conta que não existe.
    assert in_account_of_a.json()["error"] == unknown_account.json()["error"]
    assert "Intrusa" not in (await context.client_a.get(TRANSACTIONS)).text
    assert "Intrusa" not in (await context.client_b.get(TRANSACTIONS)).text


@isolation_case("GET", "/api/v1/transactions/{transaction_id}")
async def get_transaction(context: IsolationContext) -> None:
    _, _, transaction = await _transaction_of_a(context)

    await _same_as_unknown(context.client_b, "GET", f"{TRANSACTIONS}/{transaction['id']}")


@isolation_case("PATCH", "/api/v1/transactions/{transaction_id}")
async def update_transaction(context: IsolationContext) -> None:
    account_of_a, _, transaction = await _transaction_of_a(context)
    url_of_a = f"{TRANSACTIONS}/{transaction['id']}"

    await _same_as_unknown(context.client_b, "PATCH", url_of_a, json={"amount_cents": 1})
    assert (await context.client_a.get(url_of_a)).json() == transaction

    # B também não consegue mover uma transação dele para a conta de A.
    account_of_b = await create_account(context.client_b, name=_unique("Conta de B"))
    category_of_b = await create_category(context.client_b, name=_unique("Categoria de B"))
    own = await create_transaction(context.client_b, account_of_b, category_of_b)
    moved = await context.client_b.patch(
        f"{TRANSACTIONS}/{own['id']}", json={"account_id": account_of_a["id"]}
    )
    assert moved.status_code == 422
    assert "account_id" in moved.json()["error"]["details"]["fields"]


@isolation_case("DELETE", "/api/v1/transactions/{transaction_id}")
async def delete_transaction(context: IsolationContext) -> None:
    _, _, transaction = await _transaction_of_a(context)
    url_of_a = f"{TRANSACTIONS}/{transaction['id']}"

    await _same_as_unknown(context.client_b, "DELETE", url_of_a)
    assert (await context.client_a.get(url_of_a)).status_code == 200


# ---------- compras parceladas e transferências


async def _card_of(client: AsyncClient) -> Json:
    return await create_account(
        client, name=_unique("Cartão"), type="credit_card", closing_day=3, due_day=10
    )


@isolation_case("POST", "/api/v1/transactions/installments")
async def create_installments_in_another_users_card_or_category(
    context: IsolationContext,
) -> None:
    card_of_a = await _card_of(context.client_a)
    category_of_a = await _category_of_a(context)
    card_of_b = await _card_of(context.client_b)
    category_of_b = await create_category(context.client_b, name=_unique("Categoria de B"))
    payload = {
        "total_cents": 30_000,
        "installments": 3,
        "date": "2026-10-01",
        "description": "Intrusa parcelada",
    }

    in_card_of_a = await context.client_b.post(
        f"{TRANSACTIONS}/installments",
        json={**payload, "account_id": card_of_a["id"], "category_id": category_of_b["id"]},
    )
    in_category_of_a = await context.client_b.post(
        f"{TRANSACTIONS}/installments",
        json={**payload, "account_id": card_of_b["id"], "category_id": category_of_a["id"]},
    )

    assert in_card_of_a.status_code == in_category_of_a.status_code == 422
    assert "account_id" in in_card_of_a.json()["error"]["details"]["fields"]
    assert "category_id" in in_category_of_a.json()["error"]["details"]["fields"]
    assert "Intrusa" not in (await context.client_a.get(TRANSACTIONS)).text
    assert "Intrusa" not in (await context.client_b.get(TRANSACTIONS)).text


@isolation_case("POST", "/api/v1/transactions/transfers")
async def transfer_from_or_to_another_users_account(context: IsolationContext) -> None:
    account_of_a = await _account_of_a(context)
    account_of_b = await create_account(context.client_b, name=_unique("Conta de B"))
    payload = {"amount_cents": 999, "date": "2026-10-01", "description": "Intrusa"}

    from_a = await context.client_b.post(
        f"{TRANSACTIONS}/transfers",
        json={
            **payload,
            "from_account_id": account_of_a["id"],
            "to_account_id": account_of_b["id"],
        },
    )
    to_a = await context.client_b.post(
        f"{TRANSACTIONS}/transfers",
        json={
            **payload,
            "from_account_id": account_of_b["id"],
            "to_account_id": account_of_a["id"],
        },
    )
    unknown = await context.client_b.post(
        f"{TRANSACTIONS}/transfers",
        json={
            **payload,
            "from_account_id": account_of_b["id"],
            "to_account_id": str(uuid.uuid4()),
        },
    )

    assert from_a.status_code == to_a.status_code == 422
    assert "from_account_id" in from_a.json()["error"]["details"]["fields"]
    assert "to_account_id" in to_a.json()["error"]["details"]["fields"]
    # A conta de outro usuário é recusada do mesmo jeito que uma conta que não existe.
    assert to_a.json()["error"] == unknown.json()["error"]
    seen_by_a = await context.client_a.get(f"{ACCOUNTS}/{account_of_a['id']}")
    assert seen_by_a.json()["balance_cents"] == account_of_a["balance_cents"]
    assert "Intrusa" not in (await context.client_b.get(TRANSACTIONS)).text
