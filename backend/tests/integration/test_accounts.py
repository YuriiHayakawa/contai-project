"""Contas: cadastro, edição, arquivamento e exclusão (FR-019 a FR-022)."""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from app.core import clock
from tests.finance import ACCOUNTS, create_account, create_category, create_transaction


async def _error(response_coro: object) -> tuple[int, str]:
    response = await response_coro  # type: ignore[misc]
    return response.status_code, response.json()["error"]["code"]


# ---------- cadastro


async def test_create_account_with_only_name_and_type(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    response = await client_a.post(ACCOUNTS, json={"name": "  Nubank  ", "type": "checking"})

    assert response.status_code == 201
    body = response.json()
    assert body["id"]
    assert body == {
        "id": body["id"],
        "type": "checking",
        "name": "Nubank",
        "institution": None,
        "initial_balance_cents": 0,
        # Sem data informada, a referência do saldo inicial é o dia do cadastro.
        "initial_balance_date": "2026-10-01",
        "closing_day": None,
        "due_day": None,
        "archived": False,
        "balance_cents": 0,
    }


async def test_default_reference_date_is_today_in_sao_paulo(client_a: AsyncClient) -> None:
    # 02:30 UTC de 2 de outubro ainda é 23:30 de 1º de outubro em Brasília.
    clock.set_fixed_time(datetime(2026, 10, 2, 2, 30, tzinfo=UTC))
    try:
        account = await create_account(client_a)
    finally:
        clock.set_fixed_time(None)

    assert account["initial_balance_date"] == "2026-10-01"


async def test_create_account_with_institution_initial_balance_and_reference_date(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(
        client_a,
        name="Poupança",
        type="savings",
        institution="Caixa",
        initial_balance_cents=123456,
        initial_balance_date="2026-09-15",
    )

    assert account["institution"] == "Caixa"
    assert account["initial_balance_cents"] == account["balance_cents"] == 123456
    assert account["initial_balance_date"] == "2026-09-15"


async def test_credit_card_needs_closing_and_due_days_and_may_start_in_debt(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    missing = await client_a.post(ACCOUNTS, json={"name": "Cartão", "type": "credit_card"})

    assert missing.status_code == 422
    assert set(missing.json()["error"]["details"]["fields"]) == {"closing_day", "due_day"}

    card = await create_account(
        client_a,
        name="Cartão",
        type="credit_card",
        closing_day=10,
        due_day=17,
        initial_balance_cents=-25000,
    )

    assert (card["closing_day"], card["due_day"]) == (10, 17)
    assert card["balance_cents"] == -25000


async def test_closing_and_due_days_only_make_sense_for_a_credit_card(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    response = await client_a.post(
        ACCOUNTS, json={"name": "Carteira", "type": "cash", "closing_day": 10, "due_day": 17}
    )

    assert response.status_code == 422
    fields = response.json()["error"]["details"]["fields"]
    assert set(fields) == {"closing_day", "due_day"}
    assert "cartão" in fields["closing_day"]


@pytest.mark.parametrize(
    "invalid",
    [
        {"name": "   "},
        {"name": "x" * 61},
        {"type": "bitcoin"},
        {"initial_balance_cents": 10.5},
        {"initial_balance_date": "15/09/2026"},
        {"type": "credit_card", "closing_day": 0, "due_day": 10},
        {"type": "credit_card", "closing_day": 10, "due_day": 32},
        {"institution": "x" * 61},
    ],
)
async def test_create_account_validates_the_fields(
    client_a: AsyncClient, frozen_time: datetime, invalid: dict[str, object]
) -> None:
    response = await client_a.post(ACCOUNTS, json={"name": "Conta", "type": "checking", **invalid})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_name_is_unique_among_the_active_accounts(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    first = await create_account(client_a, name="Nubank")

    duplicate = await client_a.post(ACCOUNTS, json={"name": "nubank ", "type": "savings"})

    assert duplicate.status_code == 409
    error = duplicate.json()["error"]
    assert error["code"] == "account_name_taken"
    assert "outro nome" in error["message"]

    # Arquivar libera o nome.
    await client_a.post(f"{ACCOUNTS}/{first['id']}/archive")
    assert (
        await client_a.post(ACCOUNTS, json={"name": "Nubank", "type": "savings"})
    ).status_code == 201


async def test_two_users_can_use_the_same_account_name(
    client_a: AsyncClient, client_b: AsyncClient, frozen_time: datetime
) -> None:
    await create_account(client_a, name="Nubank")

    assert (
        await client_b.post(ACCOUNTS, json={"name": "Nubank", "type": "checking"})
    ).status_code == 201


async def test_accounts_require_authentication(client: AsyncClient) -> None:
    assert (await client.get(ACCOUNTS)).status_code == 401
    assert (
        await client.post(ACCOUNTS, json={"name": "Conta", "type": "checking"})
    ).status_code == 401


# ---------- consulta


async def test_list_shows_active_accounts_and_optionally_the_archived(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    await create_account(client_a, name="Conta corrente", initial_balance_cents=1000)
    archived = await create_account(client_a, name="Conta antiga")
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")

    active = (await client_a.get(ACCOUNTS)).json()["items"]
    everything = (await client_a.get(ACCOUNTS, params={"include_archived": "true"})).json()["items"]

    assert [(item["name"], item["balance_cents"]) for item in active] == [("Conta corrente", 1000)]
    assert [(item["name"], item["archived"]) for item in everything] == [
        ("Conta antiga", True),
        ("Conta corrente", False),
    ]


async def test_get_account_and_404_for_unknown(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)

    found = await client_a.get(f"{ACCOUNTS}/{account['id']}")
    missing = await client_a.get(f"{ACCOUNTS}/00000000-0000-0000-0000-000000000000")

    assert found.json() == account
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "not_found")


# ---------- edição


async def test_edit_name_institution_initial_balance_and_reference_date(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)

    response = await client_a.patch(
        f"{ACCOUNTS}/{account['id']}",
        json={
            "name": "Conta do dia a dia",
            "institution": "Inter",
            "initial_balance_cents": 5000,
            "initial_balance_date": "2026-09-01",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["institution"]) == ("Conta do dia a dia", "Inter")
    assert (body["initial_balance_cents"], body["initial_balance_date"]) == (5000, "2026-09-01")
    assert body["balance_cents"] == 5000


async def test_edit_changes_only_the_fields_sent_and_can_clear_the_institution(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a, institution="Inter", initial_balance_cents=700)

    untouched = await client_a.patch(f"{ACCOUNTS}/{account['id']}", json={"name": "Outra"})
    cleared = await client_a.patch(f"{ACCOUNTS}/{account['id']}", json={"institution": None})

    assert (untouched.json()["institution"], untouched.json()["initial_balance_cents"]) == (
        "Inter",
        700,
    )
    assert cleared.json()["institution"] is None
    assert cleared.json()["name"] == "Outra"


async def test_rename_to_a_name_in_use_is_refused(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    await create_account(client_a, name="Nubank")
    other = await create_account(client_a, name="Inter")

    status, code = await _error(
        client_a.patch(f"{ACCOUNTS}/{other['id']}", json={"name": "NUBANK"})
    )
    same_name = await client_a.patch(f"{ACCOUNTS}/{other['id']}", json={"name": "inter"})

    assert (status, code) == (409, "account_name_taken")
    # Trocar só maiúsculas no próprio nome não esbarra na conta dela mesma.
    assert same_name.status_code == 200


async def test_type_can_change_while_the_account_has_no_transactions(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)

    needs_days = await client_a.patch(f"{ACCOUNTS}/{account['id']}", json={"type": "credit_card"})
    to_card = await client_a.patch(
        f"{ACCOUNTS}/{account['id']}", json={"type": "credit_card", "closing_day": 5, "due_day": 12}
    )
    back = await client_a.patch(f"{ACCOUNTS}/{account['id']}", json={"type": "checking"})

    assert needs_days.status_code == 422
    assert (to_card.status_code, to_card.json()["closing_day"]) == (200, 5)
    # Ao deixar de ser cartão, os dias de fechamento e vencimento saem junto.
    assert (back.json()["type"], back.json()["closing_day"], back.json()["due_day"]) == (
        "checking",
        None,
        None,
    )


async def test_type_cannot_change_once_the_account_has_transactions(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)
    category = await create_category(client_a)
    await create_transaction(client_a, account, category)

    response = await client_a.patch(f"{ACCOUNTS}/{account['id']}", json={"type": "savings"})
    same_type = await client_a.patch(
        f"{ACCOUNTS}/{account['id']}", json={"type": "checking", "name": "Renomeada"}
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_type_locked"
    assert same_type.status_code == 200


# ---------- arquivar e excluir


async def test_archive_hides_the_account_and_keeps_its_history(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)
    category = await create_category(client_a)
    transaction = await create_transaction(client_a, account, category)

    archived = await client_a.post(f"{ACCOUNTS}/{account['id']}/archive")

    assert (archived.status_code, archived.json()["archived"]) == (200, True)
    assert (await client_a.get(ACCOUNTS)).json()["items"] == []
    # O histórico continua lá: a conta e a transação ainda podem ser consultadas.
    assert (await client_a.get(f"{ACCOUNTS}/{account['id']}")).json()["balance_cents"] == -4590
    kept = await client_a.get(f"/api/v1/transactions/{transaction['id']}")
    assert kept.json()["account_id"] == account["id"]

    restored = await client_a.post(f"{ACCOUNTS}/{account['id']}/unarchive")

    assert (restored.status_code, restored.json()["archived"]) == (200, False)
    assert len((await client_a.get(ACCOUNTS)).json()["items"]) == 1


async def test_unarchive_is_refused_while_another_active_account_has_the_name(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    old = await create_account(client_a, name="Nubank")
    await client_a.post(f"{ACCOUNTS}/{old['id']}/archive")
    await create_account(client_a, name="Nubank")

    status, code = await _error(client_a.post(f"{ACCOUNTS}/{old['id']}/unarchive"))

    assert (status, code) == (409, "account_name_taken")


async def test_account_without_transactions_can_be_deleted(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)

    deleted = await client_a.delete(f"{ACCOUNTS}/{account['id']}")

    assert deleted.status_code == 204
    assert (await client_a.get(f"{ACCOUNTS}/{account['id']}")).status_code == 404


async def test_account_with_transactions_can_only_be_archived(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    account = await create_account(client_a)
    category = await create_category(client_a)
    transaction = await create_transaction(client_a, account, category)

    refused = await client_a.delete(f"{ACCOUNTS}/{account['id']}")

    assert refused.status_code == 409
    error = refused.json()["error"]
    assert error["code"] == "account_has_transactions"
    assert "arquiv" in error["message"]
    assert (await client_a.get(f"{ACCOUNTS}/{account['id']}")).status_code == 200

    # Sem a transação, a exclusão passa.
    await client_a.delete(f"/api/v1/transactions/{transaction['id']}")
    assert (await client_a.delete(f"{ACCOUNTS}/{account['id']}")).status_code == 204
