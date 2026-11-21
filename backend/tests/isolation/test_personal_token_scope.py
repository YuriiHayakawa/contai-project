"""O token pessoal só serve para lançar por voz (FR-020, ADR 0012).

A varredura percorre todas as rotas do app: as que dependem de `get_current_user` recebem um
token pessoal válido e precisam responder 401. Uma rota nova entra no teste sozinha. A dependência
do token pessoal aparece em uma única rota, a de voz.
"""

import re
import uuid

from fastapi.dependencies.models import Dependant
from fastapi.routing import iter_route_contexts
from httpx import AsyncClient

from app.main import app
from app.modules.auth.dependencies import get_personal_token
from app.modules.users.models import User
from tests.finance import create_account
from tests.isolation import registry

_PATH_PARAM = re.compile(r"\{[^}]+\}")


def _uses(dependant: Dependant, call: object) -> bool:
    if dependant.call is call:
        return True
    return any(_uses(child, call) for child in dependant.dependencies)


def _routes_using(call: object) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for context in iter_route_contexts(app.routes):
        dependant = getattr(context, "dependant", None)
        if isinstance(dependant, Dependant) and context.path and _uses(dependant, call):
            found.update((method, context.path) for method in context.methods or ())
    return found


def test_only_the_voice_route_accepts_a_personal_token() -> None:
    assert _routes_using(get_personal_token) == {("POST", "/api/v1/voice/entries")}


async def test_every_session_route_refuses_a_valid_personal_token(
    client: AsyncClient, client_a: AsyncClient, user_a: User
) -> None:
    account = await create_account(client_a)
    created = await client_a.post(
        "/api/v1/personal-tokens", json={"name": "iPhone", "default_account_id": account["id"]}
    )
    bearer = {"Authorization": f"Bearer {created.json()['token']}"}
    routes = registry.authenticated_routes(app)
    assert len(routes) > 40

    accepted = []
    for method, path in sorted(routes):
        concrete = _PATH_PARAM.sub(str(uuid.uuid4()), path)
        response = await client.request(method, concrete, headers=bearer, json={})
        if response.status_code != 401:
            accepted.append((method, path, response.status_code))

    assert accepted == []
