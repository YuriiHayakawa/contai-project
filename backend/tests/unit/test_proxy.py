"""O segredo do proxy da Vercel e o IP do visitante que ele informa."""

import logging
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from app.core.logging import JsonFormatter
from app.core.proxy import DIAGNOSTIC_IP_HEADERS, PROXY_SECRET_HEADER, ProxySecretMiddleware
from app.core.rate_limit import client_ip

SECRET = "s" * 64


def _build_app(*, log_client_ip_headers: bool = False) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        ProxySecretMiddleware, secret=SECRET, log_client_ip_headers=log_client_ip_headers
    )

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


async def test_with_the_secret_the_visitor_ip_from_vercel_is_used(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/ip",
        headers={
            PROXY_SECRET_HEADER: SECRET,
            "X-Vercel-Forwarded-For": "203.0.113.10",
            # O proxy do Render reescreve estes dois com endereços que não são o do visitante.
            "X-Real-IP": "10.30.3.140",
            "X-Forwarded-For": "203.0.113.10, 76.76.21.21, 10.30.3.140",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ip": "203.0.113.10"}


async def test_only_the_first_entry_of_the_vercel_header_counts(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/ip",
        headers={PROXY_SECRET_HEADER: SECRET, "X-Vercel-Forwarded-For": "2001:db8::1, 10.0.0.1"},
    )

    assert response.json() == {"ip": "2001:db8::1"}


async def test_an_invalid_visitor_ip_is_ignored(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/ip",
        headers={PROXY_SECRET_HEADER: SECRET, "X-Vercel-Forwarded-For": "nao-e-um-ip"},
    )

    assert response.status_code == 200
    assert response.json() == {"ip": "10.0.0.7"}


# ---------- diagnóstico temporário dos cabeçalhos de IP (LOG_CLIENT_IP_HEADERS)

FROM_VERCEL = {
    PROXY_SECRET_HEADER: SECRET,
    "X-Vercel-Forwarded-For": "203.0.113.10",
    "X-Forwarded-For": "203.0.113.10, 76.76.21.21",
    "Authorization": "Bearer token-que-nao-pode-aparecer",
    "Cookie": "contai_refresh=cookie-que-nao-pode-aparecer",
}


async def _get(app: FastAPI, path: str, headers: dict[str, str]) -> None:
    transport = ASGITransport(app=app, client=("10.0.0.7", 50000))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        await client.get(path, headers=headers)


def _diagnostics(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if hasattr(record, "client_ip_headers")]


async def test_diagnostic_logs_only_the_ip_headers_of_health_checks_from_vercel(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="contai.proxy")

    await _get(_build_app(log_client_ip_headers=True), "/api/v1/health", FROM_VERCEL)

    [record] = _diagnostics(caplog)
    assert record.client_ip_headers == {
        "x-vercel-forwarded-for": "203.0.113.10",
        "x-forwarded-for": "203.0.113.10, 76.76.21.21",
        "x-real-ip": None,
        "cf-connecting-ip": None,
        "true-client-ip": None,
        "peer": "10.0.0.7",
    }
    assert set(record.client_ip_headers) == {*DIAGNOSTIC_IP_HEADERS, "peer"}
    logged = JsonFormatter().format(record)
    for forbidden in (SECRET, "token-que-nao-pode-aparecer", "cookie-que-nao-pode-aparecer"):
        assert forbidden not in logged


@pytest.mark.parametrize(
    ("log_client_ip_headers", "path", "headers"),
    [
        # Health check direto do Render, sem o segredo: fica fora do log.
        (True, "/api/v1/health", {"X-Forwarded-For": "203.0.113.10"}),
        # Variável desligada, o padrão.
        (False, "/api/v1/health", FROM_VERCEL),
        # Só os health checks entram no diagnóstico.
        (True, "/api/v1/ip", FROM_VERCEL),
    ],
)
async def test_diagnostic_stays_silent_otherwise(
    caplog: pytest.LogCaptureFixture,
    log_client_ip_headers: bool,
    path: str,
    headers: dict[str, str],
) -> None:
    caplog.set_level(logging.INFO, logger="contai.proxy")

    await _get(_build_app(log_client_ip_headers=log_client_ip_headers), path, headers)

    assert _diagnostics(caplog) == []
