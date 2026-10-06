"""O limitador de frequência e a identificação do cliente."""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers

from app.core.errors import register_error_handlers
from app.core.rate_limit import client_ip, limiter, register_rate_limiter, user_or_ip


def _build_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)
    register_rate_limiter(app)

    @app.post("/login")
    @limiter.limit("2/minute")
    async def login(request: Request) -> dict[str, str]:
        return {"ok": "true"}

    @app.post("/upload")
    @limiter.limit("1/minute", key_func=user_or_ip)
    async def upload(request: Request) -> dict[str, str]:
        return {"ok": "true"}

    return app


# O app é montado uma única vez: cada `@limiter.limit` registra o limite no limitador, e montar
# as mesmas rotas de novo contaria cada requisição em dobro.
_APP = _build_app()


@pytest_asyncio.fixture
async def api() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test") as client:
        yield client


async def test_requests_over_the_limit_get_429_with_retry_after(api: AsyncClient) -> None:
    assert (await api.post("/login")).status_code == 200
    assert (await api.post("/login")).status_code == 200

    blocked = await api.post("/login")

    assert blocked.status_code == 429
    error = blocked.json()["error"]
    assert error["code"] == "rate_limited"
    assert "Aguarde" in error["message"]
    retry_after = int(blocked.headers["Retry-After"])
    assert 1 <= retry_after <= 60
    assert error["details"] == {"retry_after": retry_after}


async def test_limits_are_counted_per_client_ip(api: AsyncClient) -> None:
    first_client = {"X-Forwarded-For": "203.0.113.10"}
    second_client = {"X-Forwarded-For": "203.0.113.20"}

    for _ in range(2):
        assert (await api.post("/login", headers=first_client)).status_code == 200

    assert (await api.post("/login", headers=first_client)).status_code == 429
    assert (await api.post("/login", headers=second_client)).status_code == 200


def _request(peer: str, forwarded: str | None) -> Request:
    headers = Headers({"x-forwarded-for": forwarded} if forwarded else {})
    return Request({"type": "http", "client": (peer, 50000), "headers": headers.raw, "state": {}})


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        # Vindo do Caddy (rede interna), vale o IP que ele acrescentou ao fim da lista.
        ("172.18.0.5", "203.0.113.10", "203.0.113.10"),
        ("172.18.0.5", "1.1.1.1, 203.0.113.10", "203.0.113.10"),
        # Conexão direta de fora: o cabeçalho pode ser forjado e é ignorado.
        ("8.8.8.8", "203.0.113.10", "8.8.8.8"),
        ("172.18.0.5", None, "172.18.0.5"),
    ],
)
def test_client_ip_only_trusts_the_internal_proxy(
    peer: str, forwarded: str | None, expected: str
) -> None:
    assert client_ip(_request(peer, forwarded)) == expected


def test_authenticated_routes_are_keyed_by_user() -> None:
    request = _request("172.18.0.5", "203.0.113.10")

    assert user_or_ip(request) == "203.0.113.10"

    request.state.user_id = "0b6f"

    assert user_or_ip(request) == "user:0b6f"
