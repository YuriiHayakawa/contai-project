"""Login, bloqueio por tentativas, refresh com rotação e logout (FR-006 a FR-009)."""

from datetime import datetime, timedelta
from http.cookies import SimpleCookie

import pytest
from argon2 import PasswordHasher
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.security import password_needs_rehash, verify_password
from app.main import app
from app.modules.auth.models import Session, SessionRevokedReason
from app.modules.users.models import User, UserStatus
from tests.conftest import (
    TEST_BASE_URL,
    TEST_PASSWORD,
    UserFactory,
    refresh_headers,
    without_request_id,
)

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/users/me"

COOKIE = "contai_refresh"
THIRTY_DAYS = timedelta(days=30)


async def _login(client: AsyncClient, user: User, password: str = TEST_PASSWORD) -> Response:
    return await client.post(LOGIN, json={"email": user.email, "password": password})


def _refresh_token(response: Response) -> str:
    token = response.cookies.get(COOKIE)
    assert token, "a resposta não trouxe o cookie de refresh"
    return token


def _bearer(response: Response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _refresh(token: str | None, headers: dict[str, str] | None = None) -> Response:
    """Chama o refresh como um navegador que tem exatamente este cookie, e nenhum outro."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as browser:
        if token is not None:
            browser.cookies.set(COOKIE, token, path=REFRESH)
        return await browser.post(
            REFRESH, headers=refresh_headers() if headers is None else headers
        )


async def _only_session(session: AsyncSession, user: User) -> Session:
    result = await session.execute(select(Session).where(Session.user_id == user.id))
    auth_session = result.scalar_one()
    await session.refresh(auth_session)
    return auth_session


# ---------- login


async def test_login_returns_an_access_token_and_sets_the_refresh_cookie(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    response = await _login(client, user_a)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]

    cookie = SimpleCookie(response.headers["set-cookie"])[COOKIE]
    assert cookie["httponly"] is True
    assert cookie["secure"] is True
    assert cookie["samesite"].lower() == "strict"
    assert cookie["path"] == "/api/v1/auth/refresh"
    assert int(cookie["max-age"]) == int(THIRTY_DAYS.total_seconds())
    # O refresh token só existe no cookie; o corpo não o traz.
    assert cookie.value not in response.text

    auth_session = await _only_session(session, user_a)
    assert auth_session.expires_at == frozen_time + THIRTY_DAYS
    # O banco guarda só o hash do segredo.
    assert auth_session.refresh_token_hash not in cookie.value


async def test_access_token_from_login_reaches_the_profile(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    login = await _login(client, user_a)

    profile = await client.get(ME, headers=_bearer(login))

    assert profile.status_code == 200
    assert profile.json() == {
        "name": "Ana",
        "email": "ana@exemplo.test",
        "status": "active",
        "two_factor_enabled": False,
        "ai_documents_consent": False,
        "deletion_scheduled_at": None,
    }


async def test_login_ignores_case_and_spaces_in_the_email(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    response = await client.post(
        LOGIN, json={"email": "  Ana@Exemplo.TEST ", "password": TEST_PASSWORD}
    )

    assert response.status_code == 200


async def test_login_answers_the_same_for_unknown_email_and_wrong_password(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    unknown = await client.post(
        LOGIN, json={"email": "ninguem@exemplo.test", "password": TEST_PASSWORD}
    )
    wrong = await _login(client, user_a, "senha errada mesmo")

    assert unknown.status_code == wrong.status_code == 401
    assert without_request_id(unknown) == without_request_id(wrong)
    assert unknown.json()["error"]["code"] == "invalid_credentials"
    assert "set-cookie" not in unknown.headers
    assert "set-cookie" not in wrong.headers


async def test_unverified_account_is_only_told_so_with_the_right_password(
    client: AsyncClient, make_user: UserFactory, frozen_time: datetime
) -> None:
    pending = await make_user(verified=False)

    wrong = await _login(client, pending, "senha errada mesmo")
    right = await _login(client, pending)

    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "invalid_credentials")
    assert (right.status_code, right.json()["error"]["code"]) == (403, "email_not_verified")
    assert "set-cookie" not in right.headers


async def test_account_with_pending_deletion_can_still_log_in_to_cancel_it(
    client: AsyncClient, make_user: UserFactory, frozen_time: datetime
) -> None:
    leaving = await make_user(status=UserStatus.PENDING_DELETION)

    login = await _login(client, leaving)

    assert login.status_code == 200
    assert (await client.get(ME, headers=_bearer(login))).json()["status"] == "pending_deletion"


async def test_login_upgrades_a_password_hash_made_with_older_parameters(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    weaker = PasswordHasher(time_cost=1, memory_cost=8 * 1024).hash(TEST_PASSWORD)
    user_a.password_hash = weaker
    await session.flush()
    assert password_needs_rehash(weaker)

    assert (await _login(client, user_a)).status_code == 200

    await session.refresh(user_a)
    assert user_a.password_hash != weaker
    assert not password_needs_rehash(user_a.password_hash)
    assert verify_password(user_a.password_hash, TEST_PASSWORD)


async def test_login_is_rate_limited_per_client(client: AsyncClient, frozen_time: datetime) -> None:
    attempt = {"email": "ninguem@exemplo.test", "password": "qualquer senha"}

    statuses = [(await client.post(LOGIN, json=attempt)).status_code for _ in range(11)]

    assert statuses == [401] * 10 + [429]


# ---------- bloqueio por tentativas


async def test_account_is_locked_for_15_minutes_after_5_wrong_passwords(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    for _ in range(5):
        assert (await _login(client, user_a, "senha errada mesmo")).status_code == 401

    # Bloqueada, mesmo com a senha certa.
    locked = await _login(client, user_a)

    assert locked.status_code == 423
    error = locked.json()["error"]
    assert error["code"] == "account_locked"
    assert error["details"] == {"retry_after": 15 * 60}
    assert locked.headers["Retry-After"] == str(15 * 60)
    assert "set-cookie" not in locked.headers

    clock.set_fixed_time(frozen_time + timedelta(minutes=14, seconds=59))
    still_locked = await _login(client, user_a)
    assert still_locked.status_code == 423
    assert still_locked.json()["error"]["details"] == {"retry_after": 1}

    clock.set_fixed_time(frozen_time + timedelta(minutes=15, seconds=1))
    assert (await _login(client, user_a)).status_code == 200
    await session.refresh(user_a)
    assert (user_a.failed_login_count, user_a.locked_until) == (0, None)


async def test_a_successful_login_resets_the_count_of_wrong_passwords(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    for _ in range(4):
        await _login(client, user_a, "senha errada mesmo")
    assert (await _login(client, user_a)).status_code == 200

    # Mais quatro erros não bloqueiam: a contagem recomeçou.
    for _ in range(4):
        assert (await _login(client, user_a, "senha errada mesmo")).status_code == 401
    assert (await _login(client, user_a)).status_code == 200


async def test_the_lock_starts_over_after_it_ends(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    for _ in range(5):
        await _login(client, user_a, "senha errada mesmo")
    clock.set_fixed_time(frozen_time + timedelta(minutes=16))

    # Um erro depois do bloqueio não bloqueia de novo: são precisos outros cinco.
    assert (await _login(client, user_a, "senha errada mesmo")).status_code == 401
    assert (await _login(client, user_a)).status_code == 200


# ---------- refresh


async def test_refresh_rotates_the_token_and_issues_a_new_access_token(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    login = await _login(client, user_a)
    clock.set_fixed_time(frozen_time + timedelta(days=3))

    refreshed = await _refresh(_refresh_token(login))

    assert refreshed.status_code == 200
    assert refreshed.json()["token_type"] == "bearer"
    assert _refresh_token(refreshed) != _refresh_token(login)
    assert (await client.get(ME, headers=_bearer(refreshed))).status_code == 200

    cookie = SimpleCookie(refreshed.headers["set-cookie"])[COOKIE]
    assert (cookie["httponly"], cookie["secure"], cookie["path"]) == (True, True, REFRESH)

    # A janela de 30 dias recomeça a cada uso.
    auth_session = await _only_session(session, user_a)
    assert auth_session.last_used_at == frozen_time + timedelta(days=3)
    assert auth_session.expires_at == frozen_time + timedelta(days=3) + THIRTY_DAYS


async def test_the_browser_sends_the_cookie_back_on_its_own(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await _login(client, user_a)

    # O mesmo cliente, com o cookie guardado pelo login, sem montar nada à mão.
    first = await client.post(REFRESH, headers=refresh_headers())
    second = await client.post(REFRESH, headers=refresh_headers())

    assert (first.status_code, second.status_code) == (200, 200)


async def test_reusing_an_old_refresh_token_revokes_the_whole_session(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    login = await _login(client, user_a)
    old_token = _refresh_token(login)
    refreshed = await _refresh(old_token)
    current_token = _refresh_token(refreshed)

    reused = await _refresh(old_token)

    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "unauthenticated"
    auth_session = await _only_session(session, user_a)
    assert auth_session.revoked_reason == SessionRevokedReason.TOKEN_REUSE
    assert auth_session.revoked_at == frozen_time
    # Nem o token atual nem o access token valem mais.
    assert (await _refresh(current_token)).status_code == 401
    assert (await client.get(ME, headers=_bearer(refreshed))).status_code == 401


@pytest.mark.parametrize(
    "tamper",
    [
        {"X-Contai-Client": None},
        {"X-Contai-Client": "outro"},
        {"Origin": None},
        {"Origin": "https://site-malicioso.example"},
    ],
    ids=["sem o cabeçalho", "cabeçalho errado", "sem Origin", "Origin de outro site"],
)
async def test_refresh_refuses_requests_that_do_not_come_from_the_app(
    client: AsyncClient, user_a: User, frozen_time: datetime, tamper: dict[str, str | None]
) -> None:
    token = _refresh_token(await _login(client, user_a))
    headers = {
        name: value for name, value in {**refresh_headers(), **tamper}.items() if value is not None
    }

    refused = await _refresh(token, headers)

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "forbidden"
    assert "set-cookie" not in refused.headers
    # A recusa não gastou o token: o app de verdade ainda consegue renovar.
    assert (await _refresh(token)).status_code == 200


@pytest.mark.parametrize(
    "token",
    [
        None,
        "sem-ponto",
        "nao-e-uuid.segredo",
        "00000000-0000-0000-0000-000000000000.segredo",
    ],
    ids=["sem cookie", "formato errado", "id inválido", "sessão que não existe"],
)
async def test_refresh_without_a_valid_cookie_is_401(
    client: AsyncClient, frozen_time: datetime, token: str | None
) -> None:
    response = await _refresh(token)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


async def test_session_expires_after_30_days_without_use(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    unused = _refresh_token(await _login(client, user_a))
    used = _refresh_token(await _login(client, user_a))

    # A segunda sessão é usada no 29º dia; a janela dela recomeça.
    clock.set_fixed_time(frozen_time + timedelta(days=29))
    renewed = await _refresh(used)
    assert renewed.status_code == 200

    clock.set_fixed_time(frozen_time + THIRTY_DAYS + timedelta(seconds=1))
    assert (await _refresh(unused)).status_code == 401
    still_valid = await _refresh(_refresh_token(renewed))
    assert still_valid.status_code == 200

    clock.set_fixed_time(frozen_time + timedelta(days=61))
    assert (await _refresh(_refresh_token(still_valid))).status_code == 401


# ---------- logout


async def test_logout_revokes_the_session_and_clears_the_cookie(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    login = await _login(client, user_a)

    logout = await client.post(LOGOUT, headers=_bearer(login))

    assert logout.status_code == 204
    cleared = SimpleCookie(logout.headers["set-cookie"])[COOKIE]
    assert cleared.value == ""
    assert (cleared["path"], int(cleared["max-age"])) == (REFRESH, 0)

    auth_session = await _only_session(session, user_a)
    assert auth_session.revoked_reason == SessionRevokedReason.LOGOUT
    # As telas internas deixam de ser acessíveis, e o refresh antigo não vale mais.
    assert (await client.get(ME, headers=_bearer(login))).status_code == 401
    assert (await _refresh(_refresh_token(login))).status_code == 401


async def test_logout_ends_only_the_session_of_that_device(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    phone = await _login(client, user_a)
    laptop = await _login(client, user_a)

    assert (await client.post(LOGOUT, headers=_bearer(phone))).status_code == 204

    assert (await client.get(ME, headers=_bearer(laptop))).status_code == 200
    assert (await _refresh(_refresh_token(laptop))).status_code == 200


async def test_logout_requires_authentication(client: AsyncClient, frozen_time: datetime) -> None:
    response = await client.post(LOGOUT)

    assert response.status_code == 401


async def test_account_with_pending_deletion_can_log_out(
    client: AsyncClient, make_user: UserFactory, frozen_time: datetime
) -> None:
    login = await _login(client, await make_user(status=UserStatus.PENDING_DELETION))

    assert (await client.post(LOGOUT, headers=_bearer(login))).status_code == 204
