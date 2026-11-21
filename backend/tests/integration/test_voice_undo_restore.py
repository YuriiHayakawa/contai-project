"""Desfazer e Refazer um lançamento por voz (feature 002, US4; research, seção 8).

Desfazer apaga a linha e devolve um token de restauração assinado, que vale 15 s. Refazer
reinsere a mesma linha, com o mesmo id, a frase e as datas. Nada fica guardado no servidor.
"""

import datetime as dt
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.security import create_restore_token
from app.modules.transactions.models import Transaction, TransactionSource, TransactionType
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.models import User
from tests.finance import create_account, create_category, create_transaction

TRANSACTIONS = "/api/v1/transactions"
RESTORE = "/api/v1/transactions/restore"

Json = dict[str, Any]

pytestmark = pytest.mark.usefixtures("frozen_time")


@pytest_asyncio.fixture
async def finances(client_a: AsyncClient) -> Json:
    account = await create_account(client_a, name="Nubank")
    category = await create_category(client_a, name="Comida na rua")
    return {"account": account, "category": category}


async def _voice_entry(session: AsyncSession, user: User, finances: Json) -> Transaction:
    account_id = uuid.UUID(finances["account"]["id"])
    description = "iFood"
    normalized = normalize_description(description)
    date = dt.date(2026, 10, 1)
    created = await TransactionRepository(session).create(
        user.id,
        account_id=account_id,
        transaction_type=TransactionType.EXPENSE,
        amount_cents=4590,
        date=date,
        description=description,
        description_normalized=normalized,
        fingerprint=fingerprint(
            account_id=account_id,
            date=date,
            transaction_type=TransactionType.EXPENSE,
            amount_cents=4590,
            description_normalized=normalized,
        ),
        created_at=clock.utcnow() - timedelta(minutes=3),
        category_id=uuid.UUID(finances["category"]["id"]),
        source=TransactionSource.VOICE,
        voice_phrase="gastei 45 e 90 no ifood",
    )
    await session.flush()
    return created


async def _row(session: AsyncSession, transaction_id: uuid.UUID) -> Transaction | None:
    session.expire_all()
    result = await session.execute(select(Transaction).where(Transaction.id == transaction_id))
    return result.scalar_one_or_none()


# ---------- desfazer


async def test_undo_deletes_and_returns_a_restore_token(
    client_a: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)

    response = await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")

    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 10
    assert body["restore_token"]
    assert await _row(session, entry.id) is None


async def test_undo_of_an_entry_that_is_not_by_voice_is_refused(
    client_a: AsyncClient, session: AsyncSession, finances: Json
) -> None:
    manual = await create_transaction(client_a, finances["account"], finances["category"])

    response = await client_a.post(f"{TRANSACTIONS}/{manual['id']}/undo-voice")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_voice_entry"
    assert await _row(session, uuid.UUID(manual["id"])) is not None


async def test_undoing_twice_says_it_was_already_undone(
    client_a: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")

    again = await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")

    assert again.status_code == 404
    assert again.json()["error"]["code"] == "transaction_not_found"


# ---------- refazer


async def test_restore_brings_back_the_identical_row(
    client_a: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    before = {
        column: getattr(entry, column)
        for column in (
            "id",
            "account_id",
            "category_id",
            "type",
            "amount_cents",
            "date",
            "description",
            "description_normalized",
            "fingerprint",
            "notes",
            "source",
            "voice_phrase",
            "created_at",
            "updated_at",
        )
    }
    token = (await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")).json()["restore_token"]

    restored = await client_a.post(RESTORE, json={"restore_token": token})

    assert restored.status_code == 201
    assert restored.json()["id"] == str(entry.id)
    assert restored.json()["source"] == "voice"
    assert restored.json()["voice_phrase"] == "gastei 45 e 90 no ifood"
    row = await _row(session, entry.id)
    assert row is not None
    assert {column: getattr(row, column) for column in before} == before


async def test_restoring_twice_does_not_duplicate(
    client_a: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    token = (await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")).json()["restore_token"]
    assert (await client_a.post(RESTORE, json={"restore_token": token})).status_code == 201

    again = await client_a.post(RESTORE, json={"restore_token": token})

    assert again.status_code == 200
    assert again.json()["id"] == str(entry.id)
    rows = await session.execute(select(Transaction).where(Transaction.user_id == user_a.id))
    assert len(list(rows.scalars())) == 1


async def test_after_15_seconds_the_deletion_is_final(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    finances: Json,
    frozen_time: datetime,
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    token = (await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")).json()["restore_token"]
    clock.set_fixed_time(frozen_time + timedelta(seconds=14))
    assert (await client_a.post(RESTORE, json={"restore_token": token})).status_code == 201
    second = await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")
    late_token = second.json()["restore_token"]

    clock.set_fixed_time(frozen_time + timedelta(seconds=14 + 16))
    late = await client_a.post(RESTORE, json={"restore_token": late_token})

    assert late.status_code == 410
    assert late.json()["error"]["code"] == "restore_expired"
    assert await _row(session, entry.id) is None


async def test_another_users_token_or_a_tampered_one_is_refused(
    client_a: AsyncClient,
    client_b: AsyncClient,
    session: AsyncSession,
    user_a: User,
    finances: Json,
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    token = (await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")).json()["restore_token"]
    header, payload, signature = token.split(".")
    tampered = f"{header}.{payload}.{signature[:-2]}xx"

    by_b = await client_b.post(RESTORE, json={"restore_token": token})
    forged = await client_a.post(RESTORE, json={"restore_token": tampered})

    assert by_b.status_code == 403
    assert forged.status_code == 401
    assert await _row(session, entry.id) is None


async def test_restore_conflicts_when_the_account_was_deleted(
    client_a: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    token = (await client_a.post(f"{TRANSACTIONS}/{entry.id}/undo-voice")).json()["restore_token"]
    assert (
        await client_a.delete(f"/api/v1/accounts/{finances['account']['id']}")
    ).status_code == 204

    response = await client_a.post(RESTORE, json={"restore_token": token})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "restore_conflict"


async def test_a_restore_token_is_not_an_access_token(
    client: AsyncClient, session: AsyncSession, user_a: User, finances: Json
) -> None:
    entry = await _voice_entry(session, user_a, finances)
    token = create_restore_token(user_a.id, {"id": str(entry.id)})

    response = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
