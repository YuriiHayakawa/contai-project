"""Cadastro, confirmação de e-mail e reenvio (FR-001, FR-003 a FR-005, FR-008)."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.config import get_settings
from app.core.security import hash_token, verify_password
from app.modules.auth.models import EmailTokenType
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.worker.models import Job
from tests.conftest import (
    ClientFactory,
    EmailDelivery,
    UserFactory,
    extract_link,
    extract_token,
    without_request_id,
)

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/verify-email"
RESEND = "/api/v1/auth/resend-verification"

EMAIL = "marina@exemplo.test"
PASSWORD = "caderneta de contas 42"


def _payload(**overrides: object) -> dict[str, object]:
    return {
        "name": "Marina Duarte",
        "email": EMAIL,
        "password": PASSWORD,
        "accept_privacy_policy": True,
        **overrides,
    }


async def _get_user(session: AsyncSession, email: str = EMAIL) -> User:
    user = await UserRepository(session).get_by_email(email)
    assert user is not None
    await session.refresh(user)
    return user


async def _count(session: AsyncSession, model: type[User] | type[Job]) -> int:
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def _register_and_get_token(client: AsyncClient, deliver_emails: EmailDelivery) -> str:
    assert (await client.post(REGISTER, json=_payload())).status_code == 202
    [message] = await deliver_emails()
    return extract_token(message)


# ---------- cadastro


async def test_register_creates_an_unverified_account_and_sends_the_confirmation_link(
    client: AsyncClient, session: AsyncSession, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    response = await client.post(REGISTER, json=_payload())

    assert response.status_code == 202
    assert "e-mail" in response.json()["message"]

    user = await _get_user(session)
    assert user.name == "Marina Duarte"
    assert user.email_verified_at is None
    assert user.privacy_policy_version
    assert user.privacy_policy_accepted_at == frozen_time
    # A senha nunca é guardada como veio: só o hash Argon2.
    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password(user.password_hash, PASSWORD)

    [message] = await deliver_emails()
    assert message["To"] == EMAIL
    assert "Marina Duarte" in message.get_content()
    origin = get_settings().app_origin
    assert extract_link(message).startswith(f"{origin}/confirmar-email?token=")


async def test_register_stores_the_email_in_lowercase_and_trims_the_name(
    client: AsyncClient, session: AsyncSession, frozen_time: datetime
) -> None:
    response = await client.post(
        REGISTER, json=_payload(email="  Marina@Exemplo.TEST ", name="  Marina  ")
    )

    assert response.status_code == 202
    assert (await _get_user(session)).name == "Marina"


@pytest.mark.parametrize("acceptance", [{"accept_privacy_policy": False}, {}])
async def test_register_requires_accepting_the_privacy_policy(
    client: AsyncClient,
    session: AsyncSession,
    frozen_time: datetime,
    acceptance: dict[str, object],
) -> None:
    payload = {key: value for key, value in _payload().items() if key != "accept_privacy_policy"}

    response = await client.post(REGISTER, json={**payload, **acceptance})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "política de privacidade" in error["details"]["fields"]["accept_privacy_policy"]
    assert await _count(session, User) == 0
    assert await _count(session, Job) == 0


@pytest.mark.parametrize(
    ("password", "hint"),
    [
        ("curta1", "pelo menos 8 caracteres"),
        ("12345678", "muito comum"),
        ("Senha123", "muito comum"),
        ("x" * 129, "no máximo 128 caracteres"),
    ],
)
async def test_register_refuses_a_weak_password_and_says_how_to_fix_it(
    client: AsyncClient, session: AsyncSession, frozen_time: datetime, password: str, hint: str
) -> None:
    response = await client.post(REGISTER, json=_payload(password=password))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "weak_password"
    assert hint in error["message"]
    assert error["details"]["fields"]["password"] == error["message"]
    assert await _count(session, User) == 0


@pytest.mark.parametrize(
    "invalid",
    [{"email": "sem-arroba"}, {"email": "a@b"}, {"name": "   "}, {"name": "x" * 101}],
)
async def test_register_validates_name_and_email(
    client: AsyncClient, frozen_time: datetime, invalid: dict[str, object]
) -> None:
    response = await client.post(REGISTER, json=_payload(**invalid))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert set(error["details"]["fields"]) == set(invalid)


async def test_register_answers_the_same_for_a_new_and_an_already_registered_email(
    client: AsyncClient,
    session: AsyncSession,
    make_user: UserFactory,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    owner = await make_user(email="dona@exemplo.test", name="Dona da Conta")
    original_hash = owner.password_hash

    for_new = await client.post(REGISTER, json=_payload())
    for_existing = await client.post(
        REGISTER, json=_payload(email="Dona@exemplo.test", name="Outra Pessoa")
    )

    assert for_new.status_code == for_existing.status_code == 202
    assert without_request_id(for_new) == without_request_id(for_existing)

    # A dona da conta é avisada por e-mail, e a conta dela não muda.
    messages = {message["To"]: message for message in await deliver_emails()}
    assert set(messages) == {EMAIL, "dona@exemplo.test"}
    notice = messages["dona@exemplo.test"]
    assert "já tem uma conta" in notice.get_content()
    assert "token=" not in notice.get_content()

    await session.refresh(owner)
    assert (owner.name, owner.password_hash) == ("Dona da Conta", original_hash)
    assert await _count(session, User) == 2


async def test_registering_again_before_confirming_sends_a_new_link_without_changing_the_account(
    client: AsyncClient, session: AsyncSession, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    first_token = await _register_and_get_token(client, deliver_emails)

    again = await client.post(REGISTER, json=_payload(name="Invasor", password="outra senha longa"))

    assert again.status_code == 202
    [message] = await deliver_emails()
    assert message["To"] == EMAIL
    user = await _get_user(session)
    assert user.name == "Marina Duarte"
    assert verify_password(user.password_hash, PASSWORD)

    # O link novo vale; o anterior deixa de valer.
    assert (await client.post(VERIFY, json={"token": first_token})).status_code == 400
    assert (await client.post(VERIFY, json={"token": extract_token(message)})).status_code == 204


async def test_two_registrations_racing_for_the_same_email_do_not_fail(
    client: AsyncClient,
    session: AsyncSession,
    make_user: UserFactory,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await make_user(email=EMAIL, name="Chegou Primeiro")
    real_lookup = UserRepository.get_by_email
    lookups = 0

    async def lookup_that_misses_once(self: UserRepository, email: str) -> User | None:
        # A primeira busca ainda não vê a conta, como se o outro cadastro estivesse em curso.
        nonlocal lookups
        lookups += 1
        return None if lookups == 1 else await real_lookup(self, email)

    monkeypatch.setattr(UserRepository, "get_by_email", lookup_that_misses_once)

    response = await client.post(REGISTER, json=_payload())

    assert response.status_code == 202
    assert await _count(session, User) == 1
    [notice] = await deliver_emails()
    assert "já tem uma conta" in notice.get_content()


async def test_register_is_rate_limited_per_client(
    client: AsyncClient, frozen_time: datetime
) -> None:
    statuses = [
        (
            await client.post(REGISTER, json=_payload(email=f"pessoa{index}@exemplo.test"))
        ).status_code
        for index in range(6)
    ]

    assert statuses == [202, 202, 202, 202, 202, 429]


# ---------- confirmação do e-mail


async def test_confirmation_link_activates_the_account_and_works_only_once(
    client: AsyncClient, session: AsyncSession, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    token = await _register_and_get_token(client, deliver_emails)

    first = await client.post(VERIFY, json={"token": token})

    assert first.status_code == 204
    assert (await _get_user(session)).email_verified_at == frozen_time

    second = await client.post(VERIFY, json={"token": token})

    assert second.status_code == 400
    error = second.json()["error"]
    assert error["code"] == "invalid_or_expired_token"
    assert "novo link" in error["message"]


async def test_confirmation_link_is_valid_for_24_hours(
    client: AsyncClient, session: AsyncSession, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    token = await _register_and_get_token(client, deliver_emails)

    clock.set_fixed_time(frozen_time + timedelta(hours=24, seconds=1))
    expired = await client.post(VERIFY, json={"token": token})

    assert expired.status_code == 400
    assert expired.json()["error"]["code"] == "invalid_or_expired_token"
    assert (await _get_user(session)).email_verified_at is None

    clock.set_fixed_time(frozen_time + timedelta(hours=23, minutes=59))
    assert (await client.post(VERIFY, json={"token": token})).status_code == 204


@pytest.mark.parametrize(
    ("token", "status", "code"),
    [
        ("nao-existe", 400, "invalid_or_expired_token"),
        ("", 422, "validation_error"),
        ("x" * 300, 422, "validation_error"),
    ],
)
async def test_unknown_confirmation_token_is_refused(
    client: AsyncClient, frozen_time: datetime, token: str, status: int, code: str
) -> None:
    response = await client.post(VERIFY, json={"token": token})

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


async def test_a_password_reset_token_does_not_confirm_the_email(
    client: AsyncClient,
    session: AsyncSession,
    make_user: UserFactory,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    user = await make_user(email=EMAIL, verified=False)
    await client.post("/api/v1/auth/password/forgot", json={"email": EMAIL})
    [message] = await deliver_emails()
    reset_token = extract_token(message)

    response = await client.post(VERIFY, json={"token": reset_token})

    assert response.status_code == 400
    await session.refresh(user)
    assert user.email_verified_at is None
    # O token continua inteiro para o uso dele.
    stored = await AuthRepository(session).get_email_token_by_hash(hash_token(reset_token))
    assert stored is not None
    assert (stored.type, stored.used_at) == (EmailTokenType.PASSWORD_RESET, None)


# ---------- reenvio


async def test_resend_sends_a_new_link_and_invalidates_the_previous_one(
    client: AsyncClient, session: AsyncSession, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    first_token = await _register_and_get_token(client, deliver_emails)

    response = await client.post(RESEND, json={"email": "MARINA@exemplo.test"})

    assert response.status_code == 202
    [message] = await deliver_emails()
    assert message["To"] == EMAIL
    assert (await client.post(VERIFY, json={"token": first_token})).status_code == 400
    assert (await client.post(VERIFY, json={"token": extract_token(message)})).status_code == 204


async def test_resend_answers_the_same_whatever_the_state_of_the_email(
    client: AsyncClient,
    make_user: UserFactory,
    deliver_emails: EmailDelivery,
    frozen_time: datetime,
) -> None:
    await make_user(email="pendente@exemplo.test", verified=False)
    await make_user(email="confirmada@exemplo.test", verified=True)

    responses = [
        await client.post(RESEND, json={"email": email})
        for email in ("pendente@exemplo.test", "confirmada@exemplo.test", "ninguem@exemplo.test")
    ]

    assert [response.status_code for response in responses] == [202, 202, 202]
    assert len({str(without_request_id(response)) for response in responses}) == 1
    # Só a conta que espera confirmação recebe e-mail.
    assert [message["To"] for message in await deliver_emails()] == ["pendente@exemplo.test"]


async def test_resend_is_rate_limited_per_client(
    client: AsyncClient, frozen_time: datetime
) -> None:
    statuses = [
        (await client.post(RESEND, json={"email": "ninguem@exemplo.test"})).status_code
        for _ in range(6)
    ]

    assert statuses == [202, 202, 202, 202, 202, 429]


# ---------- conta não confirmada


@pytest.mark.parametrize(
    ("method", "path"), [("GET", "/api/v1/users/me"), ("POST", "/api/v1/auth/logout")]
)
async def test_unverified_account_gets_403_on_every_authenticated_route(
    client_for: ClientFactory,
    make_user: UserFactory,
    frozen_time: datetime,
    method: str,
    path: str,
) -> None:
    pending = await client_for(await make_user(verified=False))

    response = await pending.request(method, path)

    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "email_not_verified"
    assert "Confirme seu e-mail" in error["message"]


async def test_unverified_account_cannot_log_in_until_it_confirms(
    client: AsyncClient, deliver_emails: EmailDelivery, frozen_time: datetime
) -> None:
    token = await _register_and_get_token(client, deliver_emails)
    credentials = {"email": EMAIL, "password": PASSWORD}

    before = await client.post("/api/v1/auth/login", json=credentials)

    assert before.status_code == 403
    assert before.json()["error"]["code"] == "email_not_verified"
    assert "set-cookie" not in before.headers

    assert (await client.post(VERIFY, json={"token": token})).status_code == 204
    after = await client.post("/api/v1/auth/login", json=credentials)

    assert after.status_code == 200
