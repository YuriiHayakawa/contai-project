"""Tokens pessoais da Siri (feature 002, US3, ADR 0012).

O token aparece uma única vez, o banco guarda só o SHA-256 do segredo, há no máximo 5 ativos por
usuário, e a revogação, pelo usuário ou pela troca de senha, vale na requisição seguinte.
"""

import hashlib
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.auth.models import PersonalToken, PersonalTokenRevokedReason
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from tests.conftest import TEST_PASSWORD, ClientFactory, EmailDelivery, extract_token
from tests.finance import create_account

TOKENS = "/api/v1/personal-tokens"
VOICE = "/api/v1/voice/entries"
PASSWORD = "/api/v1/users/me/password"
NEW_PASSWORD = "outra frase bem comprida de teste"

TOKEN_FORMAT = re.compile(r"^ctp_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$")

Json = dict[str, Any]


async def _create(client: AsyncClient, account: Json, name: str = "iPhone da Ana") -> Json:
    response = await client.post(TOKENS, json={"name": name, "default_account_id": account["id"]})
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


async def _row(session: AsyncSession, token_id: str) -> PersonalToken:
    result = await session.execute(
        select(PersonalToken).where(PersonalToken.id == uuid.UUID(token_id))
    )
    row = result.scalar_one()
    await session.refresh(row)
    return row


async def _voice_status(client: AsyncClient, token: str) -> int:
    response = await client.post(
        VOICE, json={"phrase": "gastei 10 reais"}, headers={"Authorization": f"Bearer {token}"}
    )
    return response.status_code


# ---------- criação


async def test_the_token_is_shown_once_and_only_its_hash_is_stored(
    client_a: AsyncClient, session: AsyncSession, frozen_time: datetime
) -> None:
    account = await create_account(client_a, name="Nubank")

    created = await _create(client_a, account)

    match = TOKEN_FORMAT.match(created["token"])
    assert match, created["token"]
    token_id, secret = match.groups()
    assert created["id"] == token_id
    assert created["name"] == "iPhone da Ana"
    assert created["default_account"] == {"id": account["id"], "name": "Nubank"}
    assert created["needs_default_account"] is False
    assert created["last_used_at"] is None

    row = await _row(session, token_id)
    assert row.secret_hash == hashlib.sha256(secret.encode()).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", row.secret_hash)
    stored = await session.execute(
        text("SELECT * FROM personal_tokens WHERE id = :id"), {"id": token_id}
    )
    assert secret not in str(stored.mappings().one())

    listed = (await client_a.get(TOKENS)).json()["items"]
    assert [item["id"] for item in listed] == [token_id]
    assert "token" not in listed[0]
    assert "secret_hash" not in listed[0]


async def test_name_must_have_1_to_60_characters(client_a: AsyncClient) -> None:
    account = await create_account(client_a)

    for name in ("", "   ", "x" * 61):
        response = await client_a.post(
            TOKENS, json={"name": name, "default_account_id": account["id"]}
        )
        assert response.status_code == 422, name

    accepted = await client_a.post(
        TOKENS, json={"name": "  " + "x" * 60 + "  ", "default_account_id": account["id"]}
    )
    assert accepted.status_code == 201
    assert accepted.json()["name"] == "x" * 60


async def test_the_sixth_active_token_is_refused(client_a: AsyncClient) -> None:
    account = await create_account(client_a)
    for index in range(5):
        await _create(client_a, account, name=f"Atalho {index}")

    sixth = await client_a.post(TOKENS, json={"name": "Sexto", "default_account_id": account["id"]})

    assert sixth.status_code == 409
    assert sixth.json()["error"]["code"] == "personal_token_limit"
    # Revogar um libera a vaga.
    first = (await client_a.get(TOKENS)).json()["items"][0]
    assert (await client_a.delete(f"{TOKENS}/{first['id']}")).status_code == 204
    assert (
        await client_a.post(TOKENS, json={"name": "Sexto", "default_account_id": account["id"]})
    ).status_code == 201


async def test_the_default_account_must_be_an_active_account_of_the_user(
    client_a: AsyncClient, client_b: AsyncClient
) -> None:
    other_users = await create_account(client_b)
    archived = await create_account(client_a, name="Antiga")
    assert (await client_a.post(f"/api/v1/accounts/{archived['id']}/archive")).status_code == 200

    for account_id in (other_users["id"], archived["id"], str(uuid.uuid4())):
        response = await client_a.post(
            TOKENS, json={"name": "Atalho", "default_account_id": account_id}
        )
        assert response.status_code == 422, account_id
        assert "default_account_id" in response.json()["error"]["details"]["fields"]


# ---------- conta padrão


async def test_patch_changes_the_default_account(client_a: AsyncClient) -> None:
    first = await create_account(client_a, name="Nubank")
    second = await create_account(client_a, name="Carteira", type="cash")
    created = await _create(client_a, first)

    updated = await client_a.patch(
        f"{TOKENS}/{created['id']}", json={"default_account_id": second["id"]}
    )

    assert updated.status_code == 200
    assert updated.json()["default_account"] == {"id": second["id"], "name": "Carteira"}


async def test_needs_default_account_when_it_was_archived(client_a: AsyncClient) -> None:
    account = await create_account(client_a, name="Nubank")
    created = await _create(client_a, account)

    await client_a.post(f"/api/v1/accounts/{account['id']}/archive")

    [listed] = (await client_a.get(TOKENS)).json()["items"]
    assert listed["id"] == created["id"]
    assert listed["needs_default_account"] is True


async def test_needs_default_account_when_it_was_deleted(
    client_a: AsyncClient, session: AsyncSession
) -> None:
    account = await create_account(client_a, name="Nubank")
    created = await _create(client_a, account)

    assert (await client_a.delete(f"/api/v1/accounts/{account['id']}")).status_code == 204

    [listed] = (await client_a.get(TOKENS)).json()["items"]
    assert listed["default_account"] is None
    assert listed["needs_default_account"] is True
    assert (await _row(session, created["id"])).default_account_id is None


# ---------- revogação


async def test_delete_revokes_and_the_next_request_already_fails(
    client: AsyncClient, client_a: AsyncClient, session: AsyncSession, frozen_time: datetime
) -> None:
    account = await create_account(client_a)
    created = await _create(client_a, account)

    assert (await client_a.delete(f"{TOKENS}/{created['id']}")).status_code == 204

    row = await _row(session, created["id"])
    assert row.revoked_reason == PersonalTokenRevokedReason.USER_REVOKED
    assert row.revoked_at == frozen_time
    assert (await client_a.get(TOKENS)).json()["items"] == []
    assert await _voice_status(client, created["token"]) == 401
    # Revogar de novo, ou mudar a conta, encontra um token que não existe mais.
    assert (await client_a.delete(f"{TOKENS}/{created['id']}")).status_code == 404
    assert (
        await client_a.patch(
            f"{TOKENS}/{created['id']}", json={"default_account_id": account["id"]}
        )
    ).status_code == 404


async def test_changing_the_password_revokes_the_tokens(
    client_a: AsyncClient, session: AsyncSession
) -> None:
    account = await create_account(client_a)
    created = await _create(client_a, account)

    changed = await client_a.post(
        PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert changed.status_code == 204
    row = await _row(session, created["id"])
    assert row.revoked_reason == PersonalTokenRevokedReason.PASSWORD_CHANGED


async def test_resetting_the_password_revokes_the_tokens(
    client: AsyncClient,
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    deliver_emails: EmailDelivery,
) -> None:
    account = await create_account(client_a)
    created = await _create(client_a, account)
    await client.post("/api/v1/auth/password/forgot", json={"email": user_a.email})
    [message] = await deliver_emails()

    reset = await client.post(
        "/api/v1/auth/password/reset",
        json={"token": extract_token(message), "new_password": NEW_PASSWORD},
    )

    assert reset.status_code == 204
    row = await _row(session, created["id"])
    assert row.revoked_reason == PersonalTokenRevokedReason.PASSWORD_RESET


async def test_deleting_the_user_deletes_the_tokens(
    client_a: AsyncClient, session: AsyncSession, user_a: User
) -> None:
    account = await create_account(client_a)
    await _create(client_a, account)

    await UserRepository(session).delete(user_a.id)
    await session.flush()

    count = await session.execute(
        text("SELECT count(*) FROM personal_tokens WHERE user_id = :u"), {"u": user_a.id}
    )
    assert count.scalar_one() == 0


async def test_revoked_tokens_are_purged_after_30_days(
    client_a: AsyncClient, session: AsyncSession, frozen_time: datetime
) -> None:
    from app.modules.auth.service import AuthService

    account = await create_account(client_a)
    old = await _create(client_a, account, name="Velho")
    recent = await _create(client_a, account, name="Recente")
    active = await _create(client_a, account, name="Ativo")
    await client_a.delete(f"{TOKENS}/{old['id']}")
    clock.set_fixed_time(frozen_time + timedelta(days=20))
    await client_a.delete(f"{TOKENS}/{recent['id']}")

    clock.set_fixed_time(frozen_time + timedelta(days=31))
    await AuthService(session).purge_expired_auth_data()

    remaining = await session.execute(text("SELECT name FROM personal_tokens ORDER BY name"))
    assert [row[0] for row in remaining] == [active["name"], recent["name"]]


# ---------- só a sessão gerencia os tokens


async def test_a_personal_token_cannot_manage_personal_tokens(
    client: AsyncClient, client_a: AsyncClient
) -> None:
    account = await create_account(client_a)
    created = await _create(client_a, account)
    bearer = {"Authorization": f"Bearer {created['token']}"}

    assert (await client.get(TOKENS, headers=bearer)).status_code == 401
    assert (
        await client.post(
            TOKENS, json={"name": "x", "default_account_id": account["id"]}, headers=bearer
        )
    ).status_code == 401
    assert (await client.delete(f"{TOKENS}/{created['id']}", headers=bearer)).status_code == 401


async def test_the_list_brings_only_the_users_own_tokens(
    client_for: ClientFactory, user_a: User, user_b: User
) -> None:
    client_a = await client_for(user_a)
    client_b = await client_for(user_b)
    await _create(client_a, await create_account(client_a))

    assert (await client_b.get(TOKENS)).json()["items"] == []
