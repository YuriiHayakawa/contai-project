"""Verificação em duas etapas, de ponta a ponta pelas rotas (T188).

Ativar com um código, a segunda etapa do login, códigos de recuperação de uso único, o bloqueio
por códigos errados, e desativar exigindo senha e código.
"""

from datetime import datetime, timedelta

import pyotp
from httpx import AsyncClient

from app.core import clock
from app.modules.users.models import User
from tests.conftest import TEST_PASSWORD

SETUP = "/api/v1/users/me/2fa/setup"
ENABLE = "/api/v1/users/me/2fa/enable"
DISABLE = "/api/v1/users/me/2fa/disable"
RECOVERY_CODES = "/api/v1/users/me/2fa/recovery-codes"
LOGIN = "/api/v1/auth/login"
LOGIN_2FA = "/api/v1/auth/login/2fa"
ME = "/api/v1/users/me"


def code_at(secret: str, moment: datetime) -> str:
    return pyotp.TOTP(secret).at(moment)


def wrong_code(secret: str, moment: datetime) -> str:
    """Um código numérico que não é o do passo atual (de uma hora atrás)."""
    return code_at(secret, moment - timedelta(hours=1))


async def enable_two_factor(client: AsyncClient, *, when: datetime) -> tuple[str, list[str]]:
    """Ativa a verificação em duas etapas e devolve o segredo e os códigos de recuperação."""
    clock.set_fixed_time(when)
    secret = (await client.post(SETUP)).json()["secret"]
    enabled = await client.post(ENABLE, json={"code": code_at(secret, when)})
    assert enabled.status_code == 200
    return secret, enabled.json()["recovery_codes"]


async def login(client: AsyncClient, email: str) -> dict[str, object]:
    response = await client.post(LOGIN, json={"email": email, "password": TEST_PASSWORD})
    assert response.status_code == 200
    body: dict[str, object] = response.json()
    return body


async def test_setup_then_enable_turns_it_on_and_returns_ten_recovery_codes(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    setup = (await client_a.post(SETUP)).json()
    assert setup["secret"]
    assert setup["otpauth_uri"].startswith("otpauth://totp/")

    enabled = await client_a.post(ENABLE, json={"code": code_at(setup["secret"], frozen_time)})

    assert enabled.status_code == 200
    codes = enabled.json()["recovery_codes"]
    assert len(codes) == 10
    assert len(set(codes)) == 10
    assert (await client_a.get(ME)).json()["two_factor_enabled"] is True


async def test_enable_rejects_a_wrong_code(client_a: AsyncClient, frozen_time: datetime) -> None:
    secret = (await client_a.post(SETUP)).json()["secret"]

    rejected = await client_a.post(ENABLE, json={"code": wrong_code(secret, frozen_time)})

    assert rejected.status_code == 401
    assert rejected.json()["error"]["code"] == "invalid_two_factor_code"
    assert (await client_a.get(ME)).json()["two_factor_enabled"] is False


async def test_login_with_two_factor_returns_a_challenge_without_access(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await enable_two_factor(client_a, when=frozen_time)

    response = await client.post(LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["two_factor_required"] is True
    assert body["challenge_token"]
    assert body["access_token"] is None
    assert "contai_refresh" not in response.cookies


async def test_completes_the_login_with_an_app_code(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    secret, _ = await enable_two_factor(client_a, when=frozen_time)
    challenge = (await login(client, user_a.email))["challenge_token"]

    later = frozen_time + timedelta(seconds=60)
    clock.set_fixed_time(later)
    completed = await client.post(
        LOGIN_2FA, json={"challenge_token": challenge, "code": code_at(secret, later)}
    )

    assert completed.status_code == 200
    assert completed.json()["access_token"]
    assert "contai_refresh" in completed.cookies


async def test_a_recovery_code_works_once(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    _, codes = await enable_two_factor(client_a, when=frozen_time)

    first = (await login(client, user_a.email))["challenge_token"]
    accepted = await client.post(
        LOGIN_2FA, json={"challenge_token": first, "recovery_code": codes[0]}
    )
    assert accepted.status_code == 200

    second = (await login(client, user_a.email))["challenge_token"]
    reused = await client.post(
        LOGIN_2FA, json={"challenge_token": second, "recovery_code": codes[0]}
    )
    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "invalid_two_factor_code"


async def test_wrong_codes_count_toward_the_login_lock(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    secret, _ = await enable_two_factor(client_a, when=frozen_time)
    challenge = (await login(client, user_a.email))["challenge_token"]
    bad = wrong_code(secret, frozen_time)

    for _ in range(5):
        failed = await client.post(LOGIN_2FA, json={"challenge_token": challenge, "code": bad})
        assert failed.status_code == 401

    locked = await client.post(LOGIN_2FA, json={"challenge_token": challenge, "code": bad})
    assert locked.status_code == 423
    assert locked.json()["error"]["code"] == "account_locked"


async def test_disable_requires_the_password_and_a_code(
    client_a: AsyncClient, frozen_time: datetime
) -> None:
    secret, _ = await enable_two_factor(client_a, when=frozen_time)
    later = frozen_time + timedelta(seconds=60)
    clock.set_fixed_time(later)

    wrong_password = await client_a.post(
        DISABLE, json={"password": "senha completamente errada", "code": code_at(secret, later)}
    )
    assert wrong_password.status_code == 422
    assert wrong_password.json()["error"]["code"] == "incorrect_password"

    bad_code = await client_a.post(
        DISABLE, json={"password": TEST_PASSWORD, "code": wrong_code(secret, later)}
    )
    assert bad_code.status_code == 401
    assert bad_code.json()["error"]["code"] == "invalid_two_factor_code"
    assert (await client_a.get(ME)).json()["two_factor_enabled"] is True

    disabled = await client_a.post(
        DISABLE, json={"password": TEST_PASSWORD, "code": code_at(secret, later)}
    )
    assert disabled.status_code == 204
    assert (await client_a.get(ME)).json()["two_factor_enabled"] is False


async def test_new_recovery_codes_invalidate_the_previous_ones(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    secret, old = await enable_two_factor(client_a, when=frozen_time)
    later = frozen_time + timedelta(seconds=60)
    clock.set_fixed_time(later)

    generated = await client_a.post(
        RECOVERY_CODES, json={"password": TEST_PASSWORD, "code": code_at(secret, later)}
    )
    assert generated.status_code == 200
    new = generated.json()["recovery_codes"]
    assert len(new) == 10
    assert set(new).isdisjoint(old)

    old_challenge = (await login(client, user_a.email))["challenge_token"]
    with_old = await client.post(
        LOGIN_2FA, json={"challenge_token": old_challenge, "recovery_code": old[0]}
    )
    assert with_old.status_code == 401

    new_challenge = (await login(client, user_a.email))["challenge_token"]
    with_new = await client.post(
        LOGIN_2FA, json={"challenge_token": new_challenge, "recovery_code": new[0]}
    )
    assert with_new.status_code == 200
