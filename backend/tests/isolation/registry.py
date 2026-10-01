"""Registro dos testes de isolamento entre usuários.

Toda rota autenticada precisa de um caso aqui: o usuário A cria um recurso e o usuário B tenta
alcançá-lo, e a resposta tem de ser 404. Uma rota que não tem recurso de outro usuário para
alcançar (por exemplo, "meu perfil") é registrada como isenta, com o motivo.

`test_all_routes_covered.py` percorre as rotas do app e falha se alguma rota autenticada não
tiver caso nem isenção. Assim, um endpoint novo não entra sem teste de isolamento.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User

RouteKey = tuple[str, str]  # (método, modelo do caminho), por exemplo ("GET", "/api/v1/x/{id}")


@dataclass(frozen=True)
class IsolationContext:
    """O que um caso recebe: os dois usuários, um cliente autenticado de cada e a sessão."""

    session: AsyncSession
    user_a: User
    user_b: User
    client_a: AsyncClient
    client_b: AsyncClient


IsolationCase = Callable[[IsolationContext], Awaitable[None]]

_cases: dict[RouteKey, IsolationCase] = {}
_exemptions: dict[RouteKey, str] = {}


def isolation_case(method: str, path: str) -> Callable[[IsolationCase], IsolationCase]:
    """Registra o caso de isolamento de uma rota."""

    def register(case: IsolationCase) -> IsolationCase:
        key = (method.upper(), path)
        if key in _cases:
            raise ValueError(f"caso de isolamento duplicado para {key}")
        _cases[key] = case
        return case

    return register


def exempt(method: str, path: str, reason: str) -> None:
    """Registra uma rota autenticada que não alcança recurso de outro usuário, e por quê."""
    if not reason.strip():
        raise ValueError("a isenção precisa de um motivo")
    _exemptions[(method.upper(), path)] = reason


def registered_cases() -> dict[RouteKey, IsolationCase]:
    return dict(_cases)


def registered_exemptions() -> dict[RouteKey, str]:
    return dict(_exemptions)


def _requires_authentication(dependant: Dependant) -> bool:
    if dependant.call is get_current_user:
        return True
    return any(_requires_authentication(child) for child in dependant.dependencies)


def authenticated_routes(app: FastAPI) -> set[RouteKey]:
    """Todas as rotas do app que dependem de `get_current_user`."""
    routes: set[RouteKey] = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and _requires_authentication(route.dependant):
            routes.update(
                (method, route.path) for method in route.methods or () if method != "HEAD"
            )
    return routes


def uncovered_routes(app: FastAPI) -> set[RouteKey]:
    """Rotas autenticadas sem caso de isolamento e sem isenção."""
    return authenticated_routes(app) - _cases.keys() - _exemptions.keys()


def stale_entries(app: FastAPI) -> set[RouteKey]:
    """Casos e isenções registrados para rotas que não existem mais."""
    return (_cases.keys() | _exemptions.keys()) - authenticated_routes(app)
