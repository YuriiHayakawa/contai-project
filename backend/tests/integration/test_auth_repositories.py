from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token, new_token
from app.modules.auth.models import EmailTokenType, Session, SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User, UserStatus
from app.modules.users.repository import UserRepository
from tests.conftest import UserFactory

# ---------- usuários


async def test_create_user_normalizes_email_and_sets_defaults(
    session: AsyncSession, frozen_time: datetime
) -> None:
    user = await UserRepository(session).create(
        name="Ana",
        email="Ana@Exemplo.Test",
        password_hash="hash",
        privacy_policy_version="1",
        privacy_policy_accepted_at=frozen_time,
    )

    assert user.email == "ana@exemplo.test"
    assert user.status == UserStatus.ACTIVE
    assert user.email_verified_at is None
    assert user.id is not None


async def test_get_user_by_email_ignores_case(session: AsyncSession, user_a: User) -> None:
    repository = UserRepository(session)

    assert (await repository.get_by_email("ANA@exemplo.test")) is user_a
    assert await repository.get_by_email("ninguem@exemplo.test") is None
    assert (await repository.get_by_id(user_a.id)) is user_a


async def test_save_persists_changes(session: AsyncSession, user_a: User) -> None:
    user_a.name = "Ana Maria"
    await UserRepository(session).save(user_a)
    await session.refresh(user_a)

    assert user_a.name == "Ana Maria"


async def test_delete_user_cascades_to_sessions_and_tokens(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    expires_at = frozen_time + timedelta(days=30)
    session_a = await auth.create_session(
        user_id=user_a.id,
        refresh_token_hash=hash_token(new_token()),
        user_agent="x",
        ip="1.1.1.1",
        now=frozen_time,
        expires_at=expires_at,
    )
    session_b = await auth.create_session(
        user_id=user_b.id,
        refresh_token_hash=hash_token(new_token()),
        user_agent="x",
        ip="1.1.1.1",
        now=frozen_time,
        expires_at=expires_at,
    )
    token_hash = hash_token(new_token())
    await auth.create_email_token(
        user_id=user_a.id,
        token_type=EmailTokenType.EMAIL_VERIFICATION,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    user_a_id, session_a_id, session_b_id = user_a.id, session_a.id, session_b.id

    await UserRepository(session).delete(user_a_id)
    session.expire_all()

    assert await UserRepository(session).get_by_id(user_a_id) is None
    assert await auth.get_session_by_id(session_a_id) is None
    assert await auth.get_email_token_by_hash(token_hash) is None
    assert await auth.get_session_by_id(session_b_id) is not None


# ---------- sessões


async def _new_session(auth: AuthRepository, user: User, now: datetime, days: int = 30) -> Session:
    return await auth.create_session(
        user_id=user.id,
        refresh_token_hash=hash_token(new_token()),
        user_agent="Mozilla/5.0 " + "x" * 400,
        ip="203.0.113.7",
        now=now,
        expires_at=now + timedelta(days=days),
    )


async def test_session_is_scoped_to_its_user(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    created = await _new_session(auth, user_a, frozen_time)

    assert len(created.user_agent) == 255
    assert (await auth.get_session(user_a.id, created.id)) is created
    assert await auth.get_session(user_b.id, created.id) is None
    assert (await auth.get_session_by_id(created.id)) is created


async def test_list_active_sessions_excludes_revoked_and_expired(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    active = await _new_session(auth, user_a, frozen_time)
    revoked = await _new_session(auth, user_a, frozen_time)
    await _new_session(auth, user_a, frozen_time - timedelta(days=40), days=30)  # expirada
    await _new_session(auth, user_b, frozen_time)
    await auth.revoke_session(
        user_a.id, revoked.id, reason=SessionRevokedReason.LOGOUT, now=frozen_time
    )

    sessions = await auth.list_active_sessions(user_a.id, frozen_time)

    assert [item.id for item in sessions] == [active.id]


async def test_rotate_session_changes_hash_and_extends_expiry(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    created = await _new_session(auth, user_a, frozen_time)
    old_hash = created.refresh_token_hash
    later = frozen_time + timedelta(days=3)

    # Com o usuário errado, nada muda.
    await auth.rotate_session(
        user_b.id,
        created.id,
        refresh_token_hash="x" * 64,
        ip="198.51.100.1",
        now=later,
        expires_at=later + timedelta(days=30),
    )
    await session.refresh(created)
    assert created.refresh_token_hash == old_hash

    await auth.rotate_session(
        user_a.id,
        created.id,
        refresh_token_hash="y" * 64,
        ip="198.51.100.1",
        now=later,
        expires_at=later + timedelta(days=30),
    )
    await session.refresh(created)

    assert created.refresh_token_hash == "y" * 64
    assert created.last_used_at == later
    assert created.expires_at == later + timedelta(days=30)
    assert created.ip == "198.51.100.1"


async def test_revoke_session_only_for_owner_and_only_once(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    created = await _new_session(auth, user_a, frozen_time)

    assert not await auth.revoke_session(
        user_b.id, created.id, reason=SessionRevokedReason.USER_REVOKED, now=frozen_time
    )
    assert await auth.revoke_session(
        user_a.id, created.id, reason=SessionRevokedReason.USER_REVOKED, now=frozen_time
    )
    assert not await auth.revoke_session(
        user_a.id, created.id, reason=SessionRevokedReason.LOGOUT, now=frozen_time
    )
    await session.refresh(created)

    assert created.revoked_at == frozen_time
    assert created.revoked_reason == SessionRevokedReason.USER_REVOKED


async def test_revoke_all_sessions_can_keep_the_current_one(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    current = await _new_session(auth, user_a, frozen_time)
    await _new_session(auth, user_a, frozen_time)
    await _new_session(auth, user_a, frozen_time)
    other_user_session = await _new_session(auth, user_b, frozen_time)

    revoked = await auth.revoke_all_sessions(
        user_a.id,
        reason=SessionRevokedReason.PASSWORD_CHANGED,
        now=frozen_time,
        except_session_id=current.id,
    )

    assert revoked == 2
    assert [item.id for item in await auth.list_active_sessions(user_a.id, frozen_time)] == [
        current.id
    ]
    assert len(await auth.list_active_sessions(user_b.id, frozen_time)) == 1
    assert other_user_session.revoked_at is None

    assert (
        await auth.revoke_all_sessions(
            user_a.id, reason=SessionRevokedReason.PASSWORD_RESET, now=frozen_time
        )
        == 1
    )


# ---------- tokens de e-mail


async def test_email_token_is_single_use_and_scoped_to_user(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    auth = AuthRepository(session)
    token_hash = hash_token(new_token())
    token = await auth.create_email_token(
        user_id=user_a.id,
        token_type=EmailTokenType.PASSWORD_RESET,
        token_hash=token_hash,
        expires_at=frozen_time + timedelta(hours=1),
    )

    assert (await auth.get_email_token_by_hash(token_hash)) is token
    assert await auth.get_email_token_by_hash("0" * 64) is None
    assert not await auth.mark_email_token_used(user_b.id, token.id, frozen_time)
    assert await auth.mark_email_token_used(user_a.id, token.id, frozen_time)
    assert not await auth.mark_email_token_used(user_a.id, token.id, frozen_time)


async def test_invalidate_email_tokens_only_affects_the_given_type(
    session: AsyncSession, make_user: UserFactory, frozen_time: datetime
) -> None:
    user = await make_user()
    auth = AuthRepository(session)
    expires_at = frozen_time + timedelta(hours=1)
    verification = await auth.create_email_token(
        user_id=user.id,
        token_type=EmailTokenType.EMAIL_VERIFICATION,
        token_hash=hash_token(new_token()),
        expires_at=expires_at,
    )
    reset = await auth.create_email_token(
        user_id=user.id,
        token_type=EmailTokenType.PASSWORD_RESET,
        token_hash=hash_token(new_token()),
        expires_at=expires_at,
    )

    await auth.invalidate_email_tokens(user.id, EmailTokenType.EMAIL_VERIFICATION, frozen_time)
    await session.refresh(verification)
    await session.refresh(reset)

    assert verification.used_at == frozen_time
    assert reset.used_at is None
