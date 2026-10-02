"""Garante que toda rota autenticada tem teste de isolamento, e executa os casos."""

import importlib
import pkgutil

import pytest
from fastapi import APIRouter, FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import tests.isolation as isolation_package
from app.main import app
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.users.models import User
from tests.isolation import registry
from tests.isolation.registry import IsolationContext

# Importa todos os módulos de casos (`tests/isolation/test_*.py`), para que se registrem.
for _module in pkgutil.iter_modules(isolation_package.__path__):
    if _module.name.startswith("test_") and _module.name != "test_all_routes_covered":
        importlib.import_module(f"tests.isolation.{_module.name}")


def test_every_authenticated_route_has_an_isolation_case() -> None:
    uncovered = registry.uncovered_routes(app)

    assert not uncovered, (
        "Rotas autenticadas sem teste de isolamento. Registre um caso com @isolation_case "
        f"ou uma isenção com exempt(): {sorted(uncovered)}"
    )


def test_no_isolation_entry_points_to_a_route_that_no_longer_exists() -> None:
    assert not registry.stale_entries(app)


async def test_isolation_cases(
    session: AsyncSession,
    user_a: User,
    user_b: User,
    client_a: AsyncClient,
    client_b: AsyncClient,
) -> None:
    """Executa cada caso registrado: o usuário B nunca alcança o que é do usuário A."""
    context = IsolationContext(
        session=session, user_a=user_a, user_b=user_b, client_a=client_a, client_b=client_b
    )
    for (method, path), case in sorted(registry.registered_cases().items()):
        try:
            await case(context)
        except AssertionError as error:
            raise AssertionError(f"isolamento falhou em {method} {path}: {error}") from error


# ---------- o próprio mecanismo


def _sample_app() -> FastAPI:
    sample = FastAPI()

    @sample.get("/public")
    async def public() -> dict[str, str]:
        return {}

    @sample.get("/things/{thing_id}")
    async def get_thing(thing_id: str, current: CurrentUserDep) -> dict[str, str]:
        return {}

    @sample.delete("/things/{thing_id}")
    async def delete_thing(thing_id: str, current: CurrentUserDep) -> dict[str, str]:
        return {}

    # Como no app de verdade: rotas declaradas em um router e incluídas com prefixo.
    included = APIRouter(prefix="/api/v1/notes")

    @included.get("/public")
    async def public_note() -> dict[str, str]:
        return {}

    @included.patch("/{note_id}")
    async def update_note(note_id: str, current: CurrentUserDep) -> dict[str, str]:
        return {}

    sample.include_router(included)
    return sample


def test_registry_finds_authenticated_routes_and_ignores_public_ones() -> None:
    assert registry.authenticated_routes(_sample_app()) == {
        ("GET", "/things/{thing_id}"),
        ("DELETE", "/things/{thing_id}"),
        ("PATCH", "/api/v1/notes/{note_id}"),
    }


def test_registry_sees_the_authenticated_routes_of_the_real_app() -> None:
    assert {
        ("GET", "/api/v1/users/me"),
        ("POST", "/api/v1/auth/logout"),
    } <= registry.authenticated_routes(app)


def test_registry_reports_routes_without_a_case(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(registry, "_cases", {})
    monkeypatch.setattr(registry, "_exemptions", {})
    sample = _sample_app()

    @registry.isolation_case("GET", "/things/{thing_id}")
    async def case(context: IsolationContext) -> None:
        return None

    assert registry.uncovered_routes(sample) == {
        ("DELETE", "/things/{thing_id}"),
        ("PATCH", "/api/v1/notes/{note_id}"),
    }

    registry.exempt("DELETE", "/things/{thing_id}", "exemplo de isenção")
    registry.exempt("PATCH", "/api/v1/notes/{note_id}", "exemplo de isenção")

    assert registry.uncovered_routes(sample) == set()
    assert registry.stale_entries(sample) == set()
    assert registry.stale_entries(FastAPI()) == {
        ("GET", "/things/{thing_id}"),
        ("DELETE", "/things/{thing_id}"),
        ("PATCH", "/api/v1/notes/{note_id}"),
    }


def test_registry_rejects_duplicates_and_empty_reasons(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(registry, "_cases", {})
    monkeypatch.setattr(registry, "_exemptions", {})

    @registry.isolation_case("GET", "/x")
    async def case(context: IsolationContext) -> None:
        return None

    with pytest.raises(ValueError, match="duplicado"):
        registry.isolation_case("get", "/x")(case)
    with pytest.raises(ValueError, match="motivo"):
        registry.exempt("GET", "/y", "  ")
