"""O arquivo enviado guardado no banco até o processamento (T259, ADR 0011)."""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.accounts.models import AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.imports.models import Import, ImportFormat, ImportKind
from app.modules.imports.repository import ImportRepository
from app.modules.users.models import User
from tests.imports import stored_files


async def _import_of(session: AsyncSession, user: User) -> Import:
    account = await AccountRepository(session).create(
        user.id,
        name=f"Conta {uuid.uuid4().hex[:8]}",
        account_type=AccountType.CHECKING,
        institution=None,
        initial_balance_cents=0,
        initial_balance_date=clock.today(),
        closing_day=None,
        due_day=None,
    )
    return await ImportRepository(session).create(
        user.id,
        account_id=account.id,
        kind=ImportKind.STATEMENT,
        file_format=ImportFormat.OFX,
        original_filename="extrato.ofx",
        file_hash=uuid.uuid4().hex,
        created_at=clock.utcnow(),
    )


async def test_the_file_is_saved_read_and_deleted(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    imports = ImportRepository(session)
    record = await _import_of(session, user_a)

    await imports.save_file(user_a.id, record.id, b"conteudo", created_at=frozen_time)
    assert await imports.read_file(user_a.id, record.id) == b"conteudo"

    await imports.delete_file(user_a.id, record.id)
    # Apagar de novo não é erro.
    await imports.delete_file(user_a.id, record.id)

    assert await imports.read_file(user_a.id, record.id) is None
    assert await stored_files(session) == []


async def test_another_user_can_neither_read_nor_delete_the_file(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    imports = ImportRepository(session)
    record = await _import_of(session, user_a)
    await imports.save_file(user_a.id, record.id, b"conteudo de A", created_at=frozen_time)

    assert await imports.read_file(user_b.id, record.id) is None
    await imports.delete_file(user_b.id, record.id)

    assert await imports.read_file(user_a.id, record.id) == b"conteudo de A"


async def test_deleting_the_import_deletes_its_file(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    imports = ImportRepository(session)
    record = await _import_of(session, user_a)
    await imports.save_file(user_a.id, record.id, b"conteudo", created_at=frozen_time)

    await imports.delete(user_a.id, record.id)

    assert await stored_files(session) == []
