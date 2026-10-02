"""Recuperação de senha por link enviado ao e-mail (FR-008 e FR-010)."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.config import get_settings
from app.core.security import verify_password
from app.modules.auth.models import Session, SessionRevokedReason
from app.modules.users.models import User
from tests.conftest import (
    TEST_PASSWORD,
    EmailDelivery,
    UserFactory,
    extract_link,
    extract_token,
    refresh_headers,
    without_request_id,
)

FORGOT = "/api/v1/auth/password/forgot"
RESET = "/api/v1/auth/password/reset"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
VERIFY = "/api/v1/auth/verify-email"
ME = "/api/v1/users/me"

NEW_PASSWORD = "uma senha nova e comprida"


async def _request_token(client: AsyncClient, deliver_emails: EmailDelivery, user: User) -> str:
    assert (await client.post(FORGOT, json={"email": user.email})).status_code == 202
    [message] = await deliver_emails()
    return extract_token(message)


async def _login_status(client: AsyncClient, user: User, password: str) -> int:
    response = await client.post(LOGIN, json={"email": user.email, "password": password})
    return response.status_code


async def test_forgot_answers_the_same_whether_or_not_the_email_exists(
    client: AsyncClient, user_a: User, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    existing = await client.post(FORGOT, json={"email": "ANA@exemplo.test"})
    unknown = await client.post(FORGOT, json={"email": "ninguem@exemplo.test"})

    assert existing.status_code == unknown.status_code == 202
    assert without_request_id(existing) == without_request_id(unknown)

    # Só quem tem conta recebe o link.
    [message] = await deliver_emails()
    assert message["To"] == "ana@exemplo.test"
    assert "Ana" in message.get_content()
    origin = get_settings().app_origin
    assert extract_link(message).startswith(f"{origin}/redefinir-senha?token=")


async def test_reset_changes_the_password_and_ends_every_session(
    client: AsyncClient,
    session: AsyncSession,
    user_a: User,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    credentials = {"email": user_a.email, "password": TEST_PASSWORD}
    phone = await client.post(LOGIN, json=credentials)
    laptop = await client.post(LOGIN, json=credentials)
    token = await _request_token(client, deliver_emails, user_a)

    response = await client.post(RESET, json={"token": token, "new_password": NEW_PASSWORD})

    assert response.status_code == 204
    await session.refresh(user_a)
    assert verify_password(user_a.password_hash, NEW_PASSWORD)

    # Todas as sessões foram encerradas: nem o access token nem o refresh valem mais.
    sessions = (
        await session.execute(
            select(Session)
            .where(Session.user_id == user_a.id)
            .execution_options(populate_existing=True)
        )
    ).scalars()
    assert [item.revoked_reason for item in sessions] == [SessionRevokedReason.PASSWORD_RESET] * 2
    for login in (phone, laptop):
        bearer = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert (await client.get(ME, headers=bearer)).status_code == 401
    assert (await client.post(REFRESH, headers=refresh_headers())).status_code == 401

    assert await _login_status(client, user_a, TEST_PASSWORD) == 401
    assert await _login_status(client, user_a, NEW_PASSWORD) == 200


async def test_reset_link_works_only_once(
    client: AsyncClient, user_a: User, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    token = await _request_token(client, deliver_emails, user_a)
    assert (
        await client.post(RESET, json={"token": token, "new_password": NEW_PASSWORD})
    ).status_code == 204

    again = await client.post(
        RESET, json={"token": token, "new_password": "outra senha bem comprida"}
    )

    assert again.status_code == 400
    error = again.json()["error"]
    assert error["code"] == "invalid_or_expired_token"
    assert "novo link" in error["message"]
    assert await _login_status(client, user_a, NEW_PASSWORD) == 200


async def test_reset_link_is_valid_for_1_hour(
    client: AsyncClient, user_a: User, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    token = await _request_token(client, deliver_emails, user_a)
    payload = {"token": token, "new_password": NEW_PASSWORD}

    clock.set_fixed_time(frozen_time + timedelta(hours=1, seconds=1))
    expired = await client.post(RESET, json=payload)

    assert expired.status_code == 400
    assert expired.json()["error"]["code"] == "invalid_or_expired_token"
    assert await _login_status(client, user_a, TEST_PASSWORD) == 200

    clock.set_fixed_time(frozen_time + timedelta(minutes=59))
    assert (await client.post(RESET, json=payload)).status_code == 204


async def test_a_new_request_invalidates_the_previous_link(
    client: AsyncClient, user_a: User, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    first = await _request_token(client, deliver_emails, user_a)
    second = await _request_token(client, deliver_emails, user_a)

    refused = await client.post(RESET, json={"token": first, "new_password": NEW_PASSWORD})
    accepted = await client.post(RESET, json={"token": second, "new_password": NEW_PASSWORD})

    assert (refused.status_code, accepted.status_code) == (400, 204)


@pytest.mark.parametrize(
    ("password", "hint"),
    [("curta1", "pelo menos 8 caracteres"), ("senha123", "muito comum")],
)
async def test_reset_refuses_a_weak_password_without_spending_the_link(
    client: AsyncClient,
    user_a: User,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
    password: str,
    hint: str,
) -> None:
    token = await _request_token(client, deliver_emails, user_a)

    weak = await client.post(RESET, json={"token": token, "new_password": password})

    assert weak.status_code == 422
    error = weak.json()["error"]
    assert error["code"] == "weak_password"
    assert hint in error["details"]["fields"]["new_password"]
    assert await _login_status(client, user_a, TEST_PASSWORD) == 200

    # O link continua valendo para uma senha boa.
    retry = await client.post(RESET, json={"token": token, "new_password": NEW_PASSWORD})
    assert retry.status_code == 204


async def test_reset_unlocks_an_account_locked_by_wrong_passwords(
    client: AsyncClient,
    session: AsyncSession,
    user_a: User,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    for _ in range(5):
        await _login_status(client, user_a, "senha errada mesmo")
    assert await _login_status(client, user_a, TEST_PASSWORD) == 423
    token = await _request_token(client, deliver_emails, user_a)

    await client.post(RESET, json={"token": token, "new_password": NEW_PASSWORD})

    assert await _login_status(client, user_a, NEW_PASSWORD) == 200


async def test_an_email_confirmation_token_does_not_reset_the_password(
    client: AsyncClient, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    registration = {
        "name": "Marina",
        "email": "marina@exemplo.test",
        "password": TEST_PASSWORD,
        "accept_privacy_policy": True,
    }
    await client.post("/api/v1/auth/register", json=registration)
    [message] = await deliver_emails()
    confirmation_token = extract_token(message)

    response = await client.post(
        RESET, json={"token": confirmation_token, "new_password": NEW_PASSWORD}
    )

    assert response.status_code == 400
    # O token continua valendo para confirmar o e-mail.
    assert (await client.post(VERIFY, json={"token": confirmation_token})).status_code == 204


async def test_unverified_account_can_reset_the_password_but_still_has_to_confirm(
    client: AsyncClient,
    make_user: UserFactory,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    pending = await make_user(verified=False)
    token = await _request_token(client, deliver_emails, pending)

    response = await client.post(RESET, json={"token": token, "new_password": NEW_PASSWORD})

    assert response.status_code == 204
    login = await client.post(LOGIN, json={"email": pending.email, "password": NEW_PASSWORD})
    assert (login.status_code, login.json()["error"]["code"]) == (403, "email_not_verified")


async def test_forgot_is_rate_limited_per_client(
    client: AsyncClient, frozen_time: datetime
) -> None:
    statuses = [
        (await client.post(FORGOT, json={"email": "ninguem@exemplo.test"})).status_code
        for _ in range(6)
    ]

    assert statuses == [202, 202, 202, 202, 202, 429]
