"""Dispositivos conectados e dados da conta (T190, FR-014, FR-015).

Listar as sessões com a atual marcada, encerrar uma e todas as outras, alterar o nome e trocar a
senha (que exige a senha atual e encerra as outras sessões).
"""

from httpx import AsyncClient

from app.modules.users.models import User
from tests.conftest import TEST_PASSWORD, ClientFactory

ME = "/api/v1/users/me"
SESSIONS = "/api/v1/users/me/sessions"
PASSWORD = "/api/v1/users/me/password"

NEW_PASSWORD = "outra frase bem comprida de teste"


async def test_lists_sessions_with_the_current_one_marked(
    client_for: ClientFactory, user_a: User
) -> None:
    first = await client_for(user_a)
    await client_for(user_a)  # um segundo dispositivo

    sessions = (await first.get(SESSIONS)).json()

    assert len(sessions) == 2
    assert sum(session["is_current"] for session in sessions) == 1
    assert all(session["device"] for session in sessions)
    assert all("last_used_at" in session for session in sessions)


async def test_ends_another_session(client_for: ClientFactory, user_a: User) -> None:
    first = await client_for(user_a)
    second = await client_for(user_a)

    sessions = (await first.get(SESSIONS)).json()
    other_id = next(s["id"] for s in sessions if not s["is_current"])

    ended = await first.delete(f"{SESSIONS}/{other_id}")

    assert ended.status_code == 204
    assert (await second.get(ME)).status_code == 401
    assert (await first.get(ME)).status_code == 200


async def test_ends_all_other_sessions(client_for: ClientFactory, user_a: User) -> None:
    first = await client_for(user_a)
    second = await client_for(user_a)
    third = await client_for(user_a)

    ended = await first.delete(SESSIONS)

    assert ended.status_code == 204
    assert (await second.get(ME)).status_code == 401
    assert (await third.get(ME)).status_code == 401
    assert (await first.get(ME)).status_code == 200


async def test_changes_the_name(client_for: ClientFactory, user_a: User) -> None:
    client = await client_for(user_a)

    updated = await client.patch(ME, json={"name": "Ana Paula"})

    assert updated.status_code == 200
    assert updated.json()["name"] == "Ana Paula"
    assert (await client.get(ME)).json()["name"] == "Ana Paula"


async def test_change_password_requires_the_current_one(
    client_for: ClientFactory, user_a: User
) -> None:
    client = await client_for(user_a)

    wrong = await client.post(
        PASSWORD, json={"current_password": "não é a senha", "new_password": NEW_PASSWORD}
    )

    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "incorrect_password"


async def test_change_password_ends_the_other_sessions(
    client: AsyncClient, client_for: ClientFactory, user_a: User
) -> None:
    current = await client_for(user_a)
    other = await client_for(user_a)

    changed = await current.post(
        PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert changed.status_code == 204
    # A sessão que trocou a senha continua; as outras caem (FR-015).
    assert (await current.get(ME)).status_code == 200
    assert (await other.get(ME)).status_code == 401
    # A nova senha vale para entrar.
    signed_in = await client.post(
        "/api/v1/auth/login", json={"email": user_a.email, "password": NEW_PASSWORD}
    )
    assert signed_in.json()["access_token"]
