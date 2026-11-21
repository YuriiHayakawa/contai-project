"""Isolamento do desfazer e do refazer da voz (feature 002, US4).

B não desfaz um lançamento por voz de A, e o token de restauração de A não serve para B.
"""

import uuid

from sqlalchemy import select

from app.core import clock
from app.modules.transactions.models import Transaction, TransactionSource, TransactionType
from app.modules.transactions.repository import TransactionRepository
from tests.finance import create_account, create_category
from tests.isolation.registry import IsolationContext, isolation_case


async def _voice_entry_of_a(context: IsolationContext) -> Transaction:
    suffix = uuid.uuid4().hex[:8]
    account = await create_account(context.client_a, name=f"Conta {suffix}")
    category = await create_category(context.client_a, name=f"Categoria {suffix}")
    entry = await TransactionRepository(context.session).create(
        context.user_a.id,
        account_id=uuid.UUID(account["id"]),
        transaction_type=TransactionType.EXPENSE,
        amount_cents=1000,
        date=clock.today(),
        description="Padaria",
        description_normalized="padaria",
        fingerprint=suffix,
        created_at=clock.utcnow(),
        category_id=uuid.UUID(category["id"]),
        source=TransactionSource.VOICE,
        voice_phrase="gastei 10 na padaria",
    )
    await context.session.flush()
    return entry


async def _still_there(context: IsolationContext, transaction_id: uuid.UUID) -> bool:
    # Só a coluna, direto do banco: nada do mapa de identidade da sessão é expirado.
    result = await context.session.execute(
        select(Transaction.id).where(Transaction.id == transaction_id)
    )
    return result.scalar_one_or_none() is not None


@isolation_case("POST", "/api/v1/transactions/{transaction_id}/undo-voice")
async def another_users_voice_entry_cannot_be_undone(context: IsolationContext) -> None:
    entry = await _voice_entry_of_a(context)

    undone_by_b = await context.client_b.post(f"/api/v1/transactions/{entry.id}/undo-voice")

    assert undone_by_b.status_code == 404
    assert await _still_there(context, entry.id)


@isolation_case("POST", "/api/v1/transactions/restore")
async def another_users_restore_token_is_refused(context: IsolationContext) -> None:
    entry = await _voice_entry_of_a(context)
    undone = await context.client_a.post(f"/api/v1/transactions/{entry.id}/undo-voice")
    token = undone.json()["restore_token"]

    restored_by_b = await context.client_b.post(
        "/api/v1/transactions/restore", json={"restore_token": token}
    )

    assert restored_by_b.status_code == 403
    assert not await _still_there(context, entry.id)
