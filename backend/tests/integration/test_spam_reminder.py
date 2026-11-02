"""Toda mensagem que pede para abrir um e-mail do Contaí lembra da caixa de spam (FR-089)."""

from datetime import datetime

from httpx import AsyncClient

from app.modules.auth.emails import SPAM_REMINDER
from app.modules.users.models import User
from tests.conftest import TEST_PASSWORD, UserFactory
from tests.integration.test_two_factor_reset import challenge_for, enable_two_factor

REGISTRATION = {
    "name": "Marina Duarte",
    "email": "marina@exemplo.test",
    "password": "caderneta de contas 42",
    "accept_privacy_policy": True,
}


async def test_registering_reminds_of_the_spam_folder(
    client: AsyncClient, frozen_time: datetime
) -> None:
    response = await client.post("/api/v1/auth/register", json=REGISTRATION)

    assert response.status_code == 202
    assert response.json()["message"].endswith(SPAM_REMINDER)


async def test_resending_the_confirmation_reminds_of_the_spam_folder(
    client: AsyncClient, frozen_time: datetime
) -> None:
    response = await client.post(
        "/api/v1/auth/resend-verification", json={"email": "marina@exemplo.test"}
    )

    assert response.status_code == 202
    assert response.json()["message"].endswith(SPAM_REMINDER)


async def test_an_unconfirmed_account_is_reminded_of_the_spam_folder(
    client: AsyncClient, make_user: UserFactory, frozen_time: datetime
) -> None:
    pending = await make_user(verified=False)

    response = await client.post(
        "/api/v1/auth/login", json={"email": pending.email, "password": TEST_PASSWORD}
    )

    assert response.status_code == 403
    assert response.json()["error"]["message"].endswith(SPAM_REMINDER)


async def test_forgetting_the_password_reminds_of_the_spam_folder(
    client: AsyncClient, frozen_time: datetime
) -> None:
    response = await client.post(
        "/api/v1/auth/password/forgot", json={"email": "marina@exemplo.test"}
    )

    assert response.status_code == 202
    assert response.json()["message"].endswith(SPAM_REMINDER)


async def test_asking_to_turn_off_two_factor_reminds_of_the_spam_folder(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await enable_two_factor(client_a, when=frozen_time)
    challenge = await challenge_for(client, user_a.email)

    response = await client.post(
        "/api/v1/auth/2fa/reset/request", json={"challenge_token": challenge}
    )

    assert response.status_code == 202
    assert response.json()["message"].endswith(SPAM_REMINDER)
