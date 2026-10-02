"""Categorias: as prontas do cadastro, criação, cores e arquivamento (FR-024 a FR-026)."""

from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.core import clock
from tests.conftest import TEST_PASSWORD, EmailDelivery, extract_token
from tests.finance import (
    CATEGORIES,
    create_account,
    create_category,
    create_transaction,
)

PALETTE = {"tinta", "caqui", "piscina", "mostarda", "goiaba", "mata", "ameixa", "pitanga"}

Json = dict[str, Any]


async def _tree(client: AsyncClient, **params: str) -> Json:
    response = await client.get(CATEGORIES, params=params)
    assert response.status_code == 200, response.text
    tree: Json = response.json()
    return tree


def _names(nodes: list[Json]) -> list[str]:
    return [node["name"] for node in nodes]


def _find(nodes: list[Json], name: str) -> Json:
    return next(node for node in nodes if node["name"] == name)


# ---------- categorias prontas (FR-024)


async def _register_confirm_and_login(
    client: AsyncClient, deliver_emails: EmailDelivery
) -> dict[str, str]:
    registration = {
        "name": "Marina",
        "email": "marina@exemplo.test",
        "password": TEST_PASSWORD,
        "accept_privacy_policy": True,
    }
    assert (await client.post("/api/v1/auth/register", json=registration)).status_code == 202
    [message] = await deliver_emails()
    confirmed = await client.post(
        "/api/v1/auth/verify-email", json={"token": extract_token(message)}
    )
    assert confirmed.status_code == 204
    login = await client.post(
        "/api/v1/auth/login", json={"email": "marina@exemplo.test", "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_new_user_starts_with_ready_made_categories_after_confirming_the_email(
    client: AsyncClient, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    headers = await _register_confirm_and_login(client, deliver_emails)

    tree = (await client.get(CATEGORIES, headers=headers)).json()

    expense, income = tree["expense"], tree["income"]
    assert {
        "Alimentação",
        "Transporte",
        "Moradia",
        "Lazer",
        "Saúde",
        "Educação",
        "Assinaturas",
        "Outros",
    } <= set(_names(expense))
    assert {"Mercado", "Delivery", "Restaurante"} <= set(
        _names(_find(expense, "Alimentação")["children"])
    )
    assert {"Salário", "Outros"} <= set(_names(income))

    everything = [
        *expense,
        *income,
        *(child for node in expense + income for child in node["children"]),
    ]
    for node in everything:
        assert node["icon"]
        assert node["archived"] is False
        if node["is_fallback"]:
            assert (node["name"], node["color"]) == ("Outros", "ardosia")
        else:
            assert node["color"] in PALETTE
    # Uma "Outros" por tipo, sempre por último na lista.
    assert [node["name"] for node in expense if node["is_fallback"]] == ["Outros"]
    assert [node["name"] for node in income if node["is_fallback"]] == ["Outros"]
    assert expense[-1]["name"] == income[-1]["name"] == "Outros"
    # Subcategoria usa o `kind` da mãe e aponta para ela.
    food = _find(expense, "Alimentação")
    assert all(
        (child["kind"], child["parent_id"]) == ("expense", food["id"]) for child in food["children"]
    )


async def test_resetting_the_password_of_an_unconfirmed_account_also_creates_the_categories(
    client: AsyncClient, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    # A redefinição pelo link confirma o e-mail; as categorias prontas vêm junto.
    registration = {
        "name": "Marina",
        "email": "marina@exemplo.test",
        "password": TEST_PASSWORD,
        "accept_privacy_policy": True,
    }
    await client.post("/api/v1/auth/register", json=registration)
    await deliver_emails()
    await client.post("/api/v1/auth/password/forgot", json={"email": "marina@exemplo.test"})
    [message] = await deliver_emails()
    new_password = "outra frase bem comprida"
    await client.post(
        "/api/v1/auth/password/reset",
        json={"token": extract_token(message), "new_password": new_password},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "marina@exemplo.test", "password": new_password}
    )

    tree = (
        await client.get(
            CATEGORIES, headers={"Authorization": f"Bearer {login.json()['access_token']}"}
        )
    ).json()

    assert "Alimentação" in _names(tree["expense"])
    assert "Salário" in _names(tree["income"])


async def test_account_created_without_the_email_flow_has_no_categories(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    assert await _tree(client_a) == {"expense": [], "income": []}


# ---------- criar


async def test_create_category_and_subcategory(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    parent = await create_category(client_a, name="  Pets  ", icon="paw-print", color="goiaba")
    child = await create_category(
        client_a, name="Ração", parent_id=parent["id"], icon="shopping-bag", color="mata"
    )

    assert parent == {
        "id": parent["id"],
        "name": "Pets",
        "kind": "expense",
        "parent_id": None,
        "icon": "paw-print",
        "color": "goiaba",
        "is_fallback": False,
        "archived": False,
        "children": [],
    }
    assert (child["parent_id"], child["kind"], child["color"]) == (parent["id"], "expense", "mata")

    tree = await _tree(client_a)
    assert _names(tree["expense"]) == ["Pets"]
    assert _names(tree["expense"][0]["children"]) == ["Ração"]
    assert tree["income"] == []


async def test_categories_have_only_two_levels(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    parent = await create_category(client_a, name="Pets")
    child = await create_category(client_a, name="Ração", parent_id=parent["id"])

    response = await client_a.post(
        CATEGORIES,
        json={
            "name": "Seca",
            "kind": "expense",
            "parent_id": child["id"],
            "icon": "shapes",
            "color": "mata",
        },
    )

    assert response.status_code == 422
    assert "subcategoria" in response.json()["error"]["details"]["fields"]["parent_id"]


async def test_subcategory_has_the_same_kind_as_its_parent(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    parent = await create_category(client_a, name="Pets", kind="expense")

    response = await client_a.post(
        CATEGORIES,
        json={
            "name": "Venda",
            "kind": "income",
            "parent_id": parent["id"],
            "icon": "shapes",
            "color": "mata",
        },
    )

    assert response.status_code == 422
    assert "parent_id" in response.json()["error"]["details"]["fields"]


async def test_unknown_or_archived_parent_is_refused(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    archived = await create_category(client_a, name="Pets")
    await client_a.post(f"{CATEGORIES}/{archived['id']}/archive")

    for parent_id in ("00000000-0000-0000-0000-000000000000", archived["id"]):
        response = await client_a.post(
            CATEGORIES,
            json={
                "name": "Ração",
                "kind": "expense",
                "parent_id": parent_id,
                "icon": "shapes",
                "color": "mata",
            },
        )
        assert response.status_code == 422
        assert "parent_id" in response.json()["error"]["details"]["fields"]


@pytest.mark.parametrize("color", ["ardosia", "#ff0000", "azul", "", "TINTA"])
async def test_color_outside_the_eight_palette_names_is_422(
    client_a: AsyncClient, frozen_time: datetime, color: str
) -> None:
    response = await client_a.post(
        CATEGORIES, json={"name": "Pets", "kind": "expense", "icon": "paw-print", "color": color}
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "color" in error["details"]["fields"]
    assert (await _tree(client_a))["expense"] == []


@pytest.mark.parametrize("color", sorted(PALETTE))
async def test_each_of_the_eight_palette_colors_is_accepted(
    client_a: AsyncClient, frozen_time: datetime, color: str
) -> None:
    assert (await create_category(client_a, name=f"Categoria {color}", color=color))[
        "color"
    ] == color


@pytest.mark.parametrize(
    "invalid",
    [
        {"name": "  "},
        {"name": "x" * 41},
        {"kind": "transfer"},
        {"icon": ""},
        {"icon": "Ícone Com Espaço"},
        {"icon": "x" * 41},
    ],
)
async def test_create_category_validates_the_fields(
    client_a: AsyncClient, frozen_time: datetime, invalid: dict[str, object]
) -> None:
    payload = {"name": "Pets", "kind": "expense", "icon": "paw-print", "color": "goiaba", **invalid}

    assert (await client_a.post(CATEGORIES, json=payload)).status_code == 422


async def test_name_is_unique_among_active_siblings(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    food = await create_category(client_a, name="Alimentação")
    fun = await create_category(client_a, name="Lazer", color="goiaba")
    await create_category(client_a, name="Mercado", parent_id=food["id"])

    same_level = await client_a.post(
        CATEGORIES,
        json={"name": "alimentação", "kind": "expense", "icon": "shapes", "color": "mata"},
    )
    same_parent = await client_a.post(
        CATEGORIES,
        json={
            "name": "MERCADO",
            "kind": "expense",
            "parent_id": food["id"],
            "icon": "shapes",
            "color": "mata",
        },
    )

    assert (same_level.status_code, same_level.json()["error"]["code"]) == (
        409,
        "category_name_taken",
    )
    assert same_parent.status_code == 409
    # O mesmo nome serve em outra categoria mãe e no outro tipo.
    await create_category(client_a, name="Mercado", parent_id=fun["id"])
    await create_category(client_a, name="Alimentação", kind="income", color="mostarda")


# ---------- editar


async def test_edit_name_icon_and_color(client_a: AsyncClient, frozen_time: datetime) -> None:
    category = await create_category(client_a, name="Pets", icon="paw-print", color="goiaba")

    response = await client_a.patch(
        f"{CATEGORIES}/{category['id']}", json={"name": "Bichos", "icon": "shapes", "color": "mata"}
    )
    invalid_color = await client_a.patch(
        f"{CATEGORIES}/{category['id']}", json={"color": "ardosia"}
    )
    only_name = await client_a.patch(f"{CATEGORIES}/{category['id']}", json={"name": "Animais"})

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["icon"], response.json()["color"]) == (
        "Bichos",
        "shapes",
        "mata",
    )
    assert invalid_color.status_code == 422
    assert (only_name.json()["name"], only_name.json()["color"]) == ("Animais", "mata")


async def test_rename_to_a_sibling_name_is_refused(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    await create_category(client_a, name="Alimentação")
    other = await create_category(client_a, name="Lazer")

    response = await client_a.patch(f"{CATEGORIES}/{other['id']}", json={"name": "ALIMENTAÇÃO"})
    same = await client_a.patch(f"{CATEGORIES}/{other['id']}", json={"name": "lazer"})

    assert (response.status_code, response.json()["error"]["code"]) == (409, "category_name_taken")
    assert same.status_code == 200


# ---------- "Outros" e arquivamento


async def test_the_fallback_category_cannot_be_archived_nor_change_color(
    client: AsyncClient, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    headers = await _register_confirm_and_login(client, deliver_emails)
    tree = (await client.get(CATEGORIES, headers=headers)).json()
    fallback = _find(tree["expense"], "Outros")

    archive = await client.post(f"{CATEGORIES}/{fallback['id']}/archive", headers=headers)
    recolor = await client.patch(
        f"{CATEGORIES}/{fallback['id']}", json={"color": "tinta"}, headers=headers
    )
    rename = await client.patch(
        f"{CATEGORIES}/{fallback['id']}", json={"name": "Diversos"}, headers=headers
    )

    assert (archive.status_code, archive.json()["error"]["code"]) == (409, "category_is_fallback")
    assert recolor.status_code == 422
    assert (rename.status_code, rename.json()["color"]) == (200, "ardosia")


async def test_archiving_a_parent_archives_its_children(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    food = await create_category(client_a, name="Alimentação")
    await create_category(client_a, name="Mercado", parent_id=food["id"])
    await create_category(client_a, name="Delivery", parent_id=food["id"])
    await create_category(client_a, name="Lazer", color="goiaba")

    archived = await client_a.post(f"{CATEGORIES}/{food['id']}/archive")

    assert (archived.status_code, archived.json()["archived"]) == (200, True)
    assert [child["archived"] for child in archived.json()["children"]] == [True, True]
    # Arquivada some das opções; com `include_archived`, continua consultável.
    assert _names((await _tree(client_a))["expense"]) == ["Lazer"]
    everything = (await _tree(client_a, include_archived="true"))["expense"]
    assert _names(everything) == ["Alimentação", "Lazer"]
    assert _names(_find(everything, "Alimentação")["children"]) == ["Delivery", "Mercado"]


async def test_unarchiving_a_parent_restores_the_children_archived_with_it(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    food = await create_category(client_a, name="Alimentação")
    market = await create_category(client_a, name="Mercado", parent_id=food["id"])
    delivery = await create_category(client_a, name="Delivery", parent_id=food["id"])
    # "Delivery" foi arquivada antes, por conta própria: não volta junto com a mãe.
    await client_a.post(f"{CATEGORIES}/{delivery['id']}/archive")
    clock.set_fixed_time(frozen_time.replace(hour=16))
    await client_a.post(f"{CATEGORIES}/{food['id']}/archive")

    restored = await client_a.post(f"{CATEGORIES}/{food['id']}/unarchive")

    assert (restored.status_code, restored.json()["archived"]) == (200, False)
    children = (await _tree(client_a))["expense"][0]["children"]
    assert [(child["id"], child["name"]) for child in children] == [(market["id"], "Mercado")]


async def test_child_cannot_be_unarchived_while_its_parent_is_archived(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    food = await create_category(client_a, name="Alimentação")
    market = await create_category(client_a, name="Mercado", parent_id=food["id"])
    await client_a.post(f"{CATEGORIES}/{food['id']}/archive")

    response = await client_a.post(f"{CATEGORIES}/{market['id']}/unarchive")

    assert (response.status_code, response.json()["error"]["code"]) == (
        409,
        "category_parent_archived",
    )


async def test_unarchive_is_refused_while_an_active_sibling_has_the_name(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    old = await create_category(client_a, name="Lazer")
    await client_a.post(f"{CATEGORIES}/{old['id']}/archive")
    await create_category(client_a, name="Lazer")

    response = await client_a.post(f"{CATEGORIES}/{old['id']}/unarchive")

    assert (response.status_code, response.json()["error"]["code"]) == (409, "category_name_taken")


async def test_archived_category_stays_on_old_transactions_but_takes_no_new_ones(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)
    category = await create_category(client_a, name="Lazer")
    old = await create_transaction(client_a, account, category)

    await client_a.post(f"{CATEGORIES}/{category['id']}/archive")

    kept = await client_a.get(f"/api/v1/transactions/{old['id']}")
    assert kept.json()["category_id"] == category["id"]
    new = await client_a.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "amount_cents": 100,
            "date": "2026-10-01",
            "description": "Cinema",
            "account_id": account["id"],
            "category_id": category["id"],
        },
    )
    assert new.status_code == 422
    assert "arquivada" in new.json()["error"]["details"]["fields"]["category_id"]


async def test_unknown_category_is_404(client_a: AsyncClient, frozen_time: datetime) -> None:
    missing = "00000000-0000-0000-0000-000000000000"

    assert (await client_a.patch(f"{CATEGORIES}/{missing}", json={"name": "X"})).status_code == 404
    assert (await client_a.post(f"{CATEGORIES}/{missing}/archive")).status_code == 404
    assert (await client_a.post(f"{CATEGORIES}/{missing}/unarchive")).status_code == 404


async def test_categories_require_authentication(client: AsyncClient) -> None:
    assert (await client.get(CATEGORIES)).status_code == 401
