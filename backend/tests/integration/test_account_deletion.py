"""Exclusão da conta, com 7 dias para desistir (T205, FR-017).

O pedido exige a senha (e o código, com as duas etapas ativas); a conta é desativada na hora, as
sessões são encerradas, os jobs pendentes cancelados e o aviso enviado com a data. Durante os 7
dias, só o perfil e o cancelamento funcionam; o cancelamento restaura tudo. No prazo, o worker
apaga o usuário e, em cascata, todos os seus dados e arquivos; depois, não é possível entrar.
"""

import uuid
from datetime import datetime, timedelta

import pyotp
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import SessionFactory
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import CategoryColor, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.imports.models import Import, ImportFile, ImportFormat, ImportKind
from app.modules.imports.repository import ImportRepository
from app.modules.transactions.models import Transaction, TransactionType
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.models import User, UserStatus
from app.modules.users.repository import UserRepository
from app.modules.users.service import UserService
from app.worker import queue
from app.worker.models import Job, JobType
from tests.conftest import TEST_PASSWORD, ClientFactory, EmailDelivery

ME = "/api/v1/users/me"
DELETION = "/api/v1/users/me/deletion"
SESSIONS = "/api/v1/users/me/sessions"
LOGIN = "/api/v1/auth/login"
SETUP = "/api/v1/users/me/2fa/setup"
ENABLE = "/api/v1/users/me/2fa/enable"


async def run_purge(session_factory: SessionFactory) -> int:
    async with session_factory() as session:
        return await UserService(session).purge_due_account_deletions()


async def reload_user(session_factory: SessionFactory, user_id: uuid.UUID) -> User | None:
    async with session_factory() as session:
        return await UserRepository(session).get_by_id(user_id)


async def test_request_requires_the_password(
    client_a: AsyncClient, user_a: User, frozen_time: datetime, session_factory: SessionFactory
) -> None:
    wrong = await client_a.post(DELETION, json={"password": "senha errada mesmo"})
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "incorrect_password"

    user = await reload_user(session_factory, user_a.id)
    assert user is not None and user.status == UserStatus.ACTIVE


async def test_request_deactivates_ends_sessions_and_emails(
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    deliver_emails: EmailDelivery,
) -> None:
    # Um job pendente do usuário deve ser cancelado pelo pedido de exclusão.
    async with session_factory() as session:
        await queue.enqueue(
            session, JobType.PROCESS_IMPORT, {"import_id": str(uuid.uuid4())}, user_id=user_a.id
        )

    response = await client_a.post(DELETION, json={"password": TEST_PASSWORD})
    assert response.status_code == 202
    scheduled_at = datetime.fromisoformat(response.json()["deletion_scheduled_at"])
    assert scheduled_at == frozen_time + timedelta(days=7)

    # A conta foi desativada e a sessão atual, encerrada.
    user = await reload_user(session_factory, user_a.id)
    assert user is not None and user.status == UserStatus.PENDING_DELETION
    assert (await client_a.get(ME)).status_code == 401

    # O aviso saiu com a data da exclusão; o job pendente foi cancelado, mas o do aviso ficou.
    [notice] = await deliver_emails()
    assert "excluída" in notice["Subject"].lower() or "exclu" in notice["Subject"].lower()
    assert "de 20" in notice.get_content()  # a data por extenso traz o ano

    async with session_factory() as session:
        pending = await session.execute(
            select(func.count())
            .select_from(Job)
            .where(Job.user_id == user_a.id, Job.type == JobType.PROCESS_IMPORT)
        )
        assert pending.scalar_one() == 0


async def test_during_grace_only_profile_and_cancel_work(
    client_for: ClientFactory,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
) -> None:
    await client_a.post(DELETION, json={"password": TEST_PASSWORD})

    # A sessão atual caiu; o usuário entra de novo (o login não barra conta em exclusão).
    fresh = await client_for(user_a)

    assert (await fresh.get(ME)).status_code == 200
    blocked = await fresh.get(SESSIONS)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "account_pending_deletion"

    cancelled = await fresh.delete(DELETION)
    assert cancelled.status_code == 204

    # Depois de cancelar, tudo volta a funcionar.
    assert (await fresh.get(SESSIONS)).status_code == 200
    user = await reload_user(session_factory, user_a.id)
    assert user is not None and user.status == UserStatus.ACTIVE
    assert user.deletion_scheduled_at is None


async def test_login_still_works_during_grace(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await client_a.post(DELETION, json={"password": TEST_PASSWORD})

    entered = await client.post(LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD})
    assert entered.status_code == 200
    assert entered.json()["access_token"]


async def _seed_account_with_transaction_and_file(
    session: AsyncSession, user: User, when: datetime
) -> Account:
    accounts = AccountRepository(session)
    categories = CategoryRepository(session)
    transactions = TransactionRepository(session)
    imports = ImportRepository(session)

    account = await accounts.create(
        user.id,
        name="Conta a apagar",
        account_type=AccountType.CHECKING,
        institution=None,
        initial_balance_cents=0,
        initial_balance_date=when.date(),
        closing_day=None,
        due_day=None,
    )
    category = await categories.create(
        user.id,
        name="Categoria a apagar",
        kind=CategoryKind.EXPENSE,
        parent_id=None,
        icon="cart",
        color=CategoryColor.PISCINA,
    )
    await transactions.create(
        user.id,
        account_id=account.id,
        transaction_type=TransactionType.EXPENSE,
        amount_cents=500,
        date=when.date(),
        description="Lançamento a apagar",
        description_normalized="lancamento a apagar",
        fingerprint=uuid.uuid4().hex,
        created_at=when,
        category_id=category.id,
    )
    record = await imports.create(
        user.id,
        account_id=account.id,
        kind=ImportKind.STATEMENT,
        file_format=ImportFormat.OFX,
        original_filename="extrato.ofx",
        file_hash=uuid.uuid4().hex,
        created_at=when,
    )
    await imports.save_file(user.id, record.id, b"conteudo do arquivo", created_at=when)
    return account


async def test_worker_purges_at_the_deadline_and_no_data_remains(
    client_for: ClientFactory,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    session: AsyncSession,
) -> None:
    await _seed_account_with_transaction_and_file(session, user_a, frozen_time)
    requester = await client_for(user_a)
    assert (await requester.post(DELETION, json={"password": TEST_PASSWORD})).status_code == 202

    # Antes do prazo, nada é apagado.
    clock.set_fixed_time(frozen_time + timedelta(days=6, hours=23))
    assert await run_purge(session_factory) == 0
    assert await reload_user(session_factory, user_a.id) is not None

    # Passado o prazo, o worker apaga a conta.
    clock.set_fixed_time(frozen_time + timedelta(days=7, seconds=1))
    assert await run_purge(session_factory) == 1

    # Não sobra nada: nem o usuário, nem seus dados, nem o arquivo enviado.
    assert await reload_user(session_factory, user_a.id) is None
    async with session_factory() as check:
        for model in (Account, Transaction, Import, ImportFile):
            count = await check.execute(
                select(func.count()).select_from(model).where(model.user_id == user_a.id)
            )
            assert count.scalar_one() == 0


async def test_two_factor_code_is_required_when_enabled(
    client_a: AsyncClient, user_a: User, frozen_time: datetime, session_factory: SessionFactory
) -> None:
    secret = (await client_a.post(SETUP)).json()["secret"]
    assert (
        await client_a.post(ENABLE, json={"code": pyotp.TOTP(secret).at(frozen_time)})
    ).status_code == 200

    # Só a senha não basta com as duas etapas ativas.
    only_password = await client_a.post(DELETION, json={"password": TEST_PASSWORD})
    assert only_password.status_code == 401
    assert only_password.json()["error"]["code"] == "invalid_two_factor_code"
    user = await reload_user(session_factory, user_a.id)
    assert user is not None and user.status == UserStatus.ACTIVE

    # Com a senha e um código válido, o pedido é aceito. Um passo novo, pois o da ativação já foi
    # usado e o reuso é recusado.
    later = frozen_time + timedelta(seconds=31)
    clock.set_fixed_time(later)
    with_code = await client_a.post(
        DELETION,
        json={"password": TEST_PASSWORD, "code": pyotp.TOTP(secret).at(later)},
    )
    assert with_code.status_code == 202
