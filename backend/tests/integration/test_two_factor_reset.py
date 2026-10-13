"""Recuperação de quem perdeu o celular e os códigos (T189, FR-013).

O pedido exige o desafio da senha; o link abre a contagem de 72 horas e avisa; há lembrete
24 horas antes; o cancelamento vale pelo link e por login com código válido; no prazo, o worker
desativa a verificação, apaga os códigos e encerra todas as sessões.
"""

import uuid
from datetime import datetime, timedelta

import pyotp
from httpx import AsyncClient

from app.core import clock
from app.core.database import SessionFactory
from app.modules.auth.service import AuthService
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from tests.conftest import TEST_PASSWORD, EmailDelivery, extract_token


async def run_reminders(session_factory: SessionFactory) -> int:
    """Roda a tarefa periódica de lembretes em uma sessão nova, como o worker faz."""
    async with session_factory() as session:
        return await AuthService(session).send_two_factor_reset_reminders()


async def run_apply(session_factory: SessionFactory) -> int:
    async with session_factory() as session:
        return await AuthService(session).apply_due_two_factor_resets()


async def two_factor_is_on(session_factory: SessionFactory, user_id: uuid.UUID) -> bool:
    async with session_factory() as session:
        user = await UserRepository(session).get_by_id(user_id)
        return user is not None and user.totp_enabled_at is not None


REQUEST = "/api/v1/auth/2fa/reset/request"
CONFIRM = "/api/v1/auth/2fa/reset/confirm"
CANCEL = "/api/v1/auth/2fa/reset/cancel"
LOGIN = "/api/v1/auth/login"
LOGIN_2FA = "/api/v1/auth/login/2fa"
SETUP = "/api/v1/users/me/2fa/setup"
ENABLE = "/api/v1/users/me/2fa/enable"


async def enable_two_factor(client: AsyncClient, *, when: datetime) -> str:
    clock.set_fixed_time(when)
    secret = (await client.post(SETUP)).json()["secret"]
    enabled = await client.post(ENABLE, json={"code": pyotp.TOTP(secret).at(when)})
    assert enabled.status_code == 200
    return secret


async def challenge_for(client: AsyncClient, email: str) -> str:
    response = await client.post(LOGIN, json={"email": email, "password": TEST_PASSWORD})
    return str(response.json()["challenge_token"])


async def test_request_needs_a_valid_challenge(
    client: AsyncClient, client_a: AsyncClient, user_a: User, frozen_time: datetime
) -> None:
    await enable_two_factor(client_a, when=frozen_time)

    garbage = await client.post(REQUEST, json={"challenge_token": "nao-e-um-token"})
    assert garbage.status_code == 401

    challenge = await challenge_for(client, user_a.email)
    valid = await client.post(REQUEST, json={"challenge_token": challenge})
    assert valid.status_code == 202


async def test_link_opens_the_72h_countdown_and_warns_the_user(
    client: AsyncClient,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    deliver_emails: EmailDelivery,
) -> None:
    await enable_two_factor(client_a, when=frozen_time)
    await client.post(REQUEST, json={"challenge_token": await challenge_for(client, user_a.email)})

    [link_email] = await deliver_emails()
    assert "duas etapas" in link_email["Subject"].lower() or "verificação" in link_email["Subject"]
    confirm_token = extract_token(link_email)

    confirmed = await client.post(CONFIRM, json={"token": confirm_token})
    assert confirmed.status_code == 200
    effective_at = datetime.fromisoformat(confirmed.json()["effective_at"])
    assert effective_at == frozen_time + timedelta(hours=72)

    [notice] = await deliver_emails()
    content = notice.get_content()
    assert "desativada em" in content
    assert "cancel" in content.lower()


async def _open_reset(
    client: AsyncClient,
    client_a: AsyncClient,
    user: User,
    when: datetime,
    deliver_emails: EmailDelivery,
) -> tuple[str, str]:
    """Leva o pedido até a contagem aberta; devolve o segredo e o token de cancelamento."""
    secret = await enable_two_factor(client_a, when=when)
    await client.post(REQUEST, json={"challenge_token": await challenge_for(client, user.email)})
    [link_email] = await deliver_emails()
    await client.post(CONFIRM, json={"token": extract_token(link_email)})
    [notice] = await deliver_emails()
    return secret, extract_token(notice)


async def test_reminder_is_sent_once_24h_before(
    client: AsyncClient,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    deliver_emails: EmailDelivery,
) -> None:
    await _open_reset(client, client_a, user_a, frozen_time, deliver_emails)

    clock.set_fixed_time(frozen_time + timedelta(hours=48, minutes=1))
    assert await run_reminders(session_factory) == 1
    [reminder] = await deliver_emails()
    assert "cancel" in reminder.get_content().lower()

    # Não manda de novo.
    assert await run_reminders(session_factory) == 0
    assert await deliver_emails() == []


async def test_cancel_link_stops_the_reset(
    client: AsyncClient,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    deliver_emails: EmailDelivery,
) -> None:
    _, cancel_token = await _open_reset(client, client_a, user_a, frozen_time, deliver_emails)

    cancelled = await client.post(CANCEL, json={"token": cancel_token})
    assert cancelled.status_code == 204

    clock.set_fixed_time(frozen_time + timedelta(hours=72, seconds=1))
    assert await run_apply(session_factory) == 0
    assert await two_factor_is_on(session_factory, user_a.id)


async def test_logging_in_with_a_code_cancels_the_reset(
    client: AsyncClient,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    deliver_emails: EmailDelivery,
) -> None:
    secret, _ = await _open_reset(client, client_a, user_a, frozen_time, deliver_emails)

    later = frozen_time + timedelta(seconds=60)
    clock.set_fixed_time(later)
    challenge = await challenge_for(client, user_a.email)
    done = await client.post(
        LOGIN_2FA, json={"challenge_token": challenge, "code": pyotp.TOTP(secret).at(later)}
    )
    assert done.status_code == 200

    clock.set_fixed_time(frozen_time + timedelta(hours=72, seconds=1))
    assert await run_apply(session_factory) == 0
    assert await two_factor_is_on(session_factory, user_a.id)


async def test_worker_applies_the_reset_at_the_deadline(
    client: AsyncClient,
    client_a: AsyncClient,
    user_a: User,
    frozen_time: datetime,
    session_factory: SessionFactory,
    deliver_emails: EmailDelivery,
) -> None:
    await _open_reset(client, client_a, user_a, frozen_time, deliver_emails)

    clock.set_fixed_time(frozen_time + timedelta(hours=72, seconds=1))
    assert await run_apply(session_factory) == 1

    # A verificação foi desativada e os códigos de recuperação, apagados.
    assert not await two_factor_is_on(session_factory, user_a.id)

    # Todas as sessões foram encerradas: o token que valia já não entra.
    assert (await client_a.get("/api/v1/users/me")).status_code == 401

    # Agora a entrada volta a ser só com e-mail e senha.
    plain = await client.post(LOGIN, json={"email": user_a.email, "password": TEST_PASSWORD})
    assert plain.json()["access_token"]

    [applied] = await deliver_emails()
    assert "desativada" in applied.get_content().lower()
