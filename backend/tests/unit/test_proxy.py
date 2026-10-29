"""O segredo do proxy da Vercel e o IP do visitante que ele informa."""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from app.core.proxy import PROXY_SECRET_HEADER, ProxySecretMiddleware
from app.core.rate_limit import client_ip

SECRET = "s" * 64


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(ProxySecretMiddleware, secret=SECRET)

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/ip")
    async def ip(request: Request) -> dict[str, str]:
        return {"ip": client_ip(request)}

    return app


@pytest_asyncio.fixture
async def api() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=_build_app(), client=("10.0.0.7", 50000))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        yield client


@pytest.mark.parametrize("headers", [{}, {PROXY_SECRET_HEADER: "errado"}])
async def test_requests_without_the_proxy_secret_are_refused(
    api: AsyncClient, headers: dict[str, str]
) -> None:
    response = await api.get("/api/v1/ip", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


async def test_health_check_needs_no_secret(api: AsyncClient) -> None:
    # O health check do Render chama a API direto, sem passar pela Vercel.
    assert (await api.get("/api/v1/health")).status_code == 200


async def test_with_the_secret_the_real_ip_from_the_proxy_is_used(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/ip",
        headers={
            PROXY_SECRET_HEADER: SECRET,
            "X-Real-IP": "203.0.113.10",
            # A última entrada é o IP da própria Vercel, acrescentado pelo proxy do Render.
            "X-Forwarded-For": "203.0.113.10, 76.76.21.21",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ip": "203.0.113.10"}


async def test_an_invalid_real_ip_is_ignored(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/ip", headers={PROXY_SECRET_HEADER: SECRET, "X-Real-IP": "nao-e-um-ip"}
    )

    assert response.status_code == 200
    assert response.json() == {"ip": "10.0.0.7"}
