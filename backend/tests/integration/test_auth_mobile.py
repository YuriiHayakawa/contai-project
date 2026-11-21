"""Login e renovação do app mobile (feature 002, US1, ADR 0012).

O app recebe o refresh token no corpo, sem cookie, e o guarda no Keychain. As sessões do app e do
site ficam separadas: um token de um tipo apresentado no endpoint do outro recebe 401 sem revogar
a sessão, e um desafio de duas etapas só vale no login de quem o pediu.
"""

from datetime import datetime, timedelta

import pyotp
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.main import app
from app.modules.auth.models import Session, SessionClient, SessionRevokedReason
from app.modules.users.models import User
from tests.conftest import TEST_PASSWORD, UserFactory, refresh_headers
from tests.isolation import registry

MOBILE_LOGIN = "/api/v1/auth/mobile/login"
MOBILE_LOGIN_2FA = "/api/v1/auth/mobile/login/2fa"
MOBILE_REFRESH = "/api/v1/auth/mobile/refresh"
WEB_LOGIN = "/api/v1/auth/login"
WEB_LOGIN_2FA = "/api/v1/auth/login/2fa"
WEB_REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/users/me"
SESSIONS = "/api/v1/users/me/sessions"
PASSWORD = "/api/v1/users/me/password"
SETUP_2FA = "/api/v1/users/me/2fa/setup"
ENABLE_2FA = "/api/v1/users/me/2fa/enable"

MOBILE = {"X-Contai-Client": "mobile", "User-Agent": "Contai/1.0 (iPhone; iOS 26.1)"}
NEW_PASSWORD = "outra frase bem comprida de teste"


async def _mobile_login(client: AsyncClient, user: User, password: str = TEST_PASSWORD) -> Response:
    return await client.post(
        MOBILE_LOGIN, json={"email": user.email, "password": password}, headers=MOBILE
    )


async def _mobile_refresh(client: AsyncClient, refresh_token: str) -> Response:
    return await client.post(MOBILE_REFRESH, json={"refresh_token": refresh_token}, headers=MOBILE)


def _bearer(response: Response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _sessions_of(session: AsyncSession, user: User) -> list[Session]:
    result = await session.execute(select(Session).where(Session.user_id == user.id))
    sessions = list(result.scalars())
    for auth_session in sessions:
        await session.refresh(auth_session)
    return sessions


async def _enable_two_factor(client: AsyncClient, when: datetime) -> str:
    clock.set_fixed_time(when)
    secret: str = (await client.post(SETUP_2FA)).json()["secret"]
    enabled = await client.post(ENABLE_2FA, json={"code": pyotp.TOTP(secret).at(when)})
    assert enabled.status_code == 200
    return secret


# ---------- login


async def test_mobile_login_requires_the_mobile_client_header(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    for headers in ({}, {"X-Contai-Client": "web"}):
        response = await client.post(
            MOBILE_LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD}, headers=headers
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "mobile_client_required"


async def test_mobile_login_returns_both_tokens_in_the_body_and_no_cookie(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    response = await _mobile_login(client, user_a)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert "set-cookie" not in response.headers
    assert (await client.get(ME, headers=_bearer(response))).status_code == 200

    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.client == SessionClient.MOBILE
    assert auth_session.expires_at == frozen_time + timedelta(days=30)


async def test_mobile_login_answers_wrong_credentials_like_the_site(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    wrong = await _mobile_login(client, user_a, "senha errada mesmo")
    unknown = await client.post(
        MOBILE_LOGIN,
        json={"email": "ninguem@exemplo.test", "password": "senha errada mesmo"},
        headers=MOBILE,
    )

    assert (wrong.status_code, unknown.status_code) == (401, 401)
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"]
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]


async def test_mobile_login_tells_an_unverified_account_to_confirm_the_email(
    client: AsyncClient, make_user: UserFactory, frozen_time: datetime
) -> None:
    unverified = await make_user(verified=False)

    response = await _mobile_login(client, unverified)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "email_not_verified"


async def test_mobile_login_shares_the_lock_after_5_wrong_passwords(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    # Três erros no site e dois no app somam os cinco do bloqueio: a contagem é por e-mail.
    for _ in range(3):
        wrong = {"email": user_a.email, "password": "senha errada mesmo"}
        assert (await client.post(WEB_LOGIN, json=wrong)).status_code == 401
    for _ in range(2):
        assert (await _mobile_login(client, user_a, "senha errada mesmo")).status_code == 401

    locked = await _mobile_login(client, user_a)

    assert locked.status_code == 423
    assert locked.json()["error"]["code"] == "account_locked"


async def test_mobile_login_is_rate_limited_like_the_site(
    client: AsyncClient, frozen_time: datetime
) -> None:
    statuses = [
        (
            await client.post(
                MOBILE_LOGIN,
                json={"email": f"pessoa{index}@exemplo.test", "password": "qualquer senha"},
                headers=MOBILE,
            )
        ).status_code
        for index in range(11)
    ]

    assert statuses == [401] * 10 + [429]


async def test_mobile_routes_stay_public() -> None:
    # Rotas de entrada não dependem de sessão: não entram no registro de isolamento.
    authenticated = registry.authenticated_routes(app)

    for path in (MOBILE_LOGIN, MOBILE_LOGIN_2FA, MOBILE_REFRESH):
        assert ("POST", path) not in authenticated


# ---------- duas etapas


async def test_two_factor_challenge_from_the_app_only_works_in_the_app(
    client: AsyncClient,
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    frozen_time: datetime,
) -> None:
    secret = await _enable_two_factor(client_a, frozen_time)

    challenge = await _mobile_login(client, user_a)
    assert challenge.status_code == 200
    assert challenge.json()["two_factor_required"] is True
    assert challenge.json().get("access_token") is None
    token = challenge.json()["challenge_token"]

    # No login do site, o desafio do app não vale.
    clock.set_fixed_time(frozen_time + timedelta(seconds=30))
    code = pyotp.TOTP(secret).at(clock.utcnow())
    on_the_site = await client.post(WEB_LOGIN_2FA, json={"challenge_token": token, "code": code})
    assert on_the_site.status_code == 401

    signed_in = await client.post(
        MOBILE_LOGIN_2FA, json={"challenge_token": token, "code": code}, headers=MOBILE
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["refresh_token"]
    assert "set-cookie" not in signed_in.headers
    mobile_sessions = [
        item for item in await _sessions_of(session, user_a) if item.client == SessionClient.MOBILE
    ]
    assert len(mobile_sessions) == 1


async def test_two_factor_challenge_from_the_site_does_not_work_in_the_app(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    secret = await _enable_two_factor(client_a, frozen_time)
    challenge = await client.post(
        WEB_LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD}
    )
    token = challenge.json()["challenge_token"]
    clock.set_fixed_time(frozen_time + timedelta(seconds=30))
    code = pyotp.TOTP(secret).at(clock.utcnow())

    in_the_app = await client.post(
        MOBILE_LOGIN_2FA, json={"challenge_token": token, "code": code}, headers=MOBILE
    )

    assert in_the_app.status_code == 401


async def test_mobile_two_factor_requires_the_mobile_client_header(
    client: AsyncClient, frozen_time: datetime
) -> None:
    response = await client.post(
        MOBILE_LOGIN_2FA, json={"challenge_token": "qualquer", "code": "123456"}
    )

    assert response.status_code == 400


# ---------- renovação


async def test_mobile_refresh_rotates_the_token(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    login = await _mobile_login(client, user_a)
    clock.set_fixed_time(frozen_time + timedelta(days=3))

    refreshed = await _mobile_refresh(client, login.json()["refresh_token"])

    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != login.json()["refresh_token"]
    assert "set-cookie" not in refreshed.headers
    assert (await client.get(ME, headers=_bearer(refreshed))).status_code == 200
    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.expires_at == frozen_time + timedelta(days=33)


async def test_mobile_refresh_requires_the_mobile_client_header(
    client: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    login = await _mobile_login(client, user_a)

    response = await client.post(
        MOBILE_REFRESH, json={"refresh_token": login.json()["refresh_token"]}
    )

    assert response.status_code == 400
    # A recusa não gastou o token.
    assert (await _mobile_refresh(client, login.json()["refresh_token"])).status_code == 200


async def test_reusing_an_old_mobile_refresh_token_revokes_the_session(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    old_token = (await _mobile_login(client, user_a)).json()["refresh_token"]
    current = (await _mobile_refresh(client, old_token)).json()["refresh_token"]

    reused = await _mobile_refresh(client, old_token)

    assert reused.status_code == 401
    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.revoked_reason == SessionRevokedReason.TOKEN_REUSE
    assert (await _mobile_refresh(client, current)).status_code == 401


async def test_a_mobile_token_on_the_site_refresh_is_refused_without_revoking(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    mobile_token = (await _mobile_login(client, user_a)).json()["refresh_token"]
    client.cookies.set("contai_refresh", mobile_token, path=WEB_REFRESH)

    on_the_site = await client.post(WEB_REFRESH, headers=refresh_headers())

    assert on_the_site.status_code == 401
    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.revoked_at is None
    assert (await _mobile_refresh(client, mobile_token)).status_code == 200


async def test_a_site_token_on_the_mobile_refresh_is_refused_without_revoking(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    web_login = await client.post(
        WEB_LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD}
    )
    web_token = web_login.cookies["contai_refresh"]

    in_the_app = await _mobile_refresh(client, web_token)

    assert in_the_app.status_code == 401
    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.revoked_at is None
    assert (await client.post(WEB_REFRESH, headers=refresh_headers())).status_code == 200


async def test_mobile_refresh_refuses_malformed_tokens(
    client: AsyncClient, frozen_time: datetime
) -> None:
    for token in ("sem-ponto", "nao-e-uuid.segredo", "00000000-0000-0000-0000-000000000000.x"):
        assert (await _mobile_refresh(client, token)).status_code == 401


# ---------- saída, troca de senha e lista de sessões


async def test_logout_ends_the_mobile_session(
    client: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    login = await _mobile_login(client, user_a)

    assert (await client.post(LOGOUT, headers=_bearer(login))).status_code == 204

    [auth_session] = await _sessions_of(session, user_a)
    assert auth_session.revoked_reason == SessionRevokedReason.LOGOUT
    assert (await _mobile_refresh(client, login.json()["refresh_token"])).status_code == 401


async def test_changing_the_password_on_the_site_ends_the_mobile_sessions(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    login = await _mobile_login(client, user_a)

    changed = await client_a.post(
        PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert changed.status_code == 204
    assert (await client.get(ME, headers=_bearer(login))).status_code == 401
    assert (await _mobile_refresh(client, login.json()["refresh_token"])).status_code == 401


async def test_the_session_list_tells_the_app_apart_from_the_site(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await _mobile_login(client, user_a)

    sessions = (await client_a.get(SESSIONS)).json()

    assert sorted(item["client"] for item in sessions) == ["mobile", "web"]
