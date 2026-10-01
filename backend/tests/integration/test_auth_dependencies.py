"""A dependência de autenticação, exercitada por rotas mínimas de teste."""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import SessionFactory, get_session
from app.core.errors import register_error_handlers
from app.core.security import create_access_token, create_challenge_token, hash_token, new_token
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.auth.models import Session, SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User, UserStatus
from tests.conftest import UserFactory


def _build_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/api/v1/users/me")
    async def me(current: CurrentUserDep) -> dict[str, str]:
        return {"user_id": str(current.id), "session_id": str(current.session_id)}

    @app.delete("/api/v1/users/me/deletion")
    async def cancel_deletion(current: CurrentUserDep) -> dict[str, str]:
        return {"user_id": str(current.id)}

    @app.get("/api/v1/accounts")
    async def accounts(current: CurrentUserDep) -> dict[str, str]:
        return {"user_id": str(current.id)}

    return app


@pytest_asyncio.fixture
async def api(session_factory: SessionFactory) -> AsyncIterator[AsyncClient]:
    app = _build_app()

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as request_session:
            yield request_session

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _login(session: AsyncSession, user: User, days: int = 30) -> tuple[Session, str]:
    now = clock.utcnow()
    auth_session = await AuthRepository(session).create_session(
        user_id=user.id,
        refresh_token_hash=hash_token(new_token()),
        user_agent="pytest",
        ip="127.0.0.1",
        now=now,
        expires_at=now + timedelta(days=days),
    )
    return auth_session, create_access_token(user.id, auth_session.id)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_valid_token_gives_access(
    api: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    auth_session, token = await _login(session, user_a)

    response = await api.get("/api/v1/users/me", headers=_bearer(token))

    assert response.status_code == 200
    assert response.json() == {"user_id": str(user_a.id), "session_id": str(auth_session.id)}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nao-e-um-token"}])
async def test_missing_or_invalid_token_is_unauthenticated(
    api: AsyncClient, headers: dict[str, str]
) -> None:
    response = await api.get("/api/v1/accounts", headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


async def test_challenge_token_is_not_an_access_token(
    api: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    response = await api.get("/api/v1/accounts", headers=_bearer(create_challenge_token(user_a.id)))

    assert response.status_code == 401


async def test_expired_access_token_is_rejected(
    api: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    _, token = await _login(session, user_a)
    clock.set_fixed_time(frozen_time + timedelta(minutes=16))

    response = await api.get("/api/v1/accounts", headers=_bearer(token))

    assert response.status_code == 401


async def test_revoked_session_loses_access_immediately(
    api: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    auth_session, token = await _login(session, user_a)
    assert (await api.get("/api/v1/accounts", headers=_bearer(token))).status_code == 200

    await AuthRepository(session).revoke_session(
        user_a.id, auth_session.id, reason=SessionRevokedReason.USER_REVOKED, now=frozen_time
    )
    await session.flush()

    response = await api.get("/api/v1/accounts", headers=_bearer(token))

    assert response.status_code == 401


async def test_expired_session_is_rejected_even_with_fresh_token(
    api: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    auth_session, _ = await _login(session, user_a, days=1)
    clock.set_fixed_time(frozen_time + timedelta(days=2))
    fresh_token = create_access_token(user_a.id, auth_session.id)

    response = await api.get("/api/v1/accounts", headers=_bearer(fresh_token))

    assert response.status_code == 401


async def test_token_for_another_users_session_is_rejected(
    api: AsyncClient, session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    session_of_a, _ = await _login(session, user_a)
    forged = create_access_token(user_b.id, session_of_a.id)

    response = await api.get("/api/v1/accounts", headers=_bearer(forged))

    assert response.status_code == 401


async def test_token_for_unknown_session_is_rejected(
    api: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    token = create_access_token(user_a.id, uuid.uuid4())

    response = await api.get("/api/v1/accounts", headers=_bearer(token))

    assert response.status_code == 401


async def test_unverified_email_has_no_access(
    api: AsyncClient, session: AsyncSession, make_user: UserFactory, frozen_time: datetime
) -> None:
    user = await make_user(verified=False)
    _, token = await _login(session, user)

    for path in ("/api/v1/users/me", "/api/v1/accounts"):
        response = await api.get(path, headers=_bearer(token))

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "email_not_verified"


async def test_pending_deletion_only_reaches_profile_and_cancellation(
    api: AsyncClient, session: AsyncSession, make_user: UserFactory, frozen_time: datetime
) -> None:
    user = await make_user(status=UserStatus.PENDING_DELETION)
    _, token = await _login(session, user)
    headers = _bearer(token)

    blocked = await api.get("/api/v1/accounts", headers=headers)

    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "account_pending_deletion"
    assert (await api.get("/api/v1/users/me", headers=headers)).status_code == 200
    assert (await api.delete("/api/v1/users/me/deletion", headers=headers)).status_code == 200
