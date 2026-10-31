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

    @app.post("/api/v1/ip")
    async def ip(request: Request) -> dict[str, str]:
        return {"ip": client_ip(request)}

    return app


@pytest_asyncio.fixture
async def api() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=_build_app(), client=("10.30.3.140", 50000))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        yield client


@pytest.mark.parametrize("headers", [{}, {PROXY_SECRET_HEADER: "errado"}])
async def test_requests_without_the_proxy_secret_are_refused(
    api: AsyncClient, headers: dict[str, str]
) -> None:
    response = await api.post("/api/v1/ip", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


async def test_health_check_needs_no_secret(api: AsyncClient) -> None:
    # O health check do Render chama a API direto, sem passar pela Vercel.
    assert (await api.get("/api/v1/health")).status_code == 200


# Cadeias registradas no Render durante a validação do deploy: a Vercel grava o IP do visitante
# e descarta o que o cliente mandou; a Cloudflare e o proxy do Render acrescentam ao fim o IP da
# Vercel, o da Cloudflare e o salto interno.
VISITOR = "177.235.165.224"
CHAIN_FROM_RENDER = f"{VISITOR},54.207.107.89, 172.68.19.232, 10.28.250.167"


async def test_with_the_secret_the_first_forwarded_for_entry_is_the_visitor(
    api: AsyncClient,
) -> None:
    response = await api.post(
        "/api/v1/ip",
        headers={
            PROXY_SECRET_HEADER: SECRET,
            "X-Forwarded-For": CHAIN_FROM_RENDER,
            # Em POST, a Vercel deixa passar este cabeçalho como o cliente mandou: não vale.
            "X-Vercel-Forwarded-For": "1.2.3.4",
            "CF-Connecting-IP": "54.207.107.89",
            "True-Client-IP": "54.207.107.89",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ip": VISITOR}


async def test_an_ipv6_visitor_is_read_from_the_first_entry(api: AsyncClient) -> None:
    response = await api.post(
        "/api/v1/ip",
        headers={
            PROXY_SECRET_HEADER: SECRET,
            "X-Forwarded-For": "2001:db8::1,54.207.107.89, 172.68.19.232, 10.28.250.167",
        },
    )

    assert response.json() == {"ip": "2001:db8::1"}


@pytest.mark.parametrize(
    ("forwarded", "expected"),
    [
        # Sem uma primeira entrada válida, vale a regra de desenvolvimento (ver `client_ip`): a
        # conexão, ou a última entrada quando a conexão vem da rede interna.
        (None, "10.30.3.140"),
        ("nao-e-um-ip, 54.207.107.89", "54.207.107.89"),
    ],
)
async def test_without_a_valid_first_entry_the_development_rule_applies(
    api: AsyncClient, forwarded: str | None, expected: str
) -> None:
    headers = {PROXY_SECRET_HEADER: SECRET}
    if forwarded:
        headers["X-Forwarded-For"] = forwarded

    response = await api.post("/api/v1/ip", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"ip": expected}
