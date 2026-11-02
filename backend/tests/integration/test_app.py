"""Comportamento comum a toda a API: formato de erro, id da requisição e cabeçalhos."""

import json
import logging
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.errors import Conflict, NotFound, RateLimited
from app.core.logging import JsonFormatter
from app.core.proxy import PROXY_SECRET_HEADER
from app.main import create_app


class _Body(BaseModel):
    amount_cents: int = Field(gt=0)
    description: str


def _app_with_test_routes(app: FastAPI) -> FastAPI:
    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("senha=123 não pode aparecer na resposta")

    @app.get("/missing")
    async def missing() -> None:
        raise NotFound()

    @app.get("/conflict")
    async def conflict() -> None:
        raise Conflict(
            "Esta conta tem lançamentos e não pode ser excluída. Você pode arquivá-la.",
            code="account_has_transactions",
        )

    @app.get("/limited")
    async def limited() -> None:
        raise RateLimited(42)

    @app.post("/validate")
    async def validate(body: _Body) -> dict[str, int]:
        return {"amount_cents": body.amount_cents}

    return app


@pytest_asyncio.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = _app_with_test_routes(create_app())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_domain_error_uses_the_standard_format(api: AsyncClient) -> None:
    response = await api.get("/missing")

    assert response.status_code == 404
    body = response.json()
    assert body["error"] == {
        "code": "not_found",
        "message": "Não encontramos o que você procura.",
        "details": {},
    }
    assert body["request_id"] == response.headers["X-Request-ID"]


async def test_domain_error_can_carry_its_own_code_and_message(api: AsyncClient) -> None:
    response = await api.get("/conflict")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_has_transactions"
    assert "arquivá-la" in response.json()["error"]["message"]


async def test_rate_limited_error_sends_retry_after(api: AsyncClient) -> None:
    response = await api.get("/limited")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "42"
    assert response.json()["error"]["details"] == {"retry_after": 42}


async def test_unknown_route_and_wrong_method_use_the_standard_format(api: AsyncClient) -> None:
    not_found = await api.get("/nao-existe")
    wrong_method = await api.delete("/missing")

    assert (not_found.status_code, not_found.json()["error"]["code"]) == (404, "not_found")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["error"]["code"] == "method_not_allowed"


async def test_validation_error_lists_the_fields_in_portuguese(api: AsyncClient) -> None:
    response = await api.post("/validate", json={"amount_cents": 0})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"] == "Confira os campos destacados."
    assert error["details"]["fields"] == {
        "amount_cents": "Valor inválido.",
        "description": "Valor inválido.",
    }


async def test_unexpected_error_hides_details_and_keeps_request_id(
    api: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="contai.errors"):
        response = await api.get("/boom")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert "senha" not in response.text
    assert body["request_id"] == response.headers["X-Request-ID"]
    # A resposta de erro também leva os cabeçalhos de segurança.
    assert response.headers["X-Content-Type-Options"] == "nosniff"

    # O log registra o tipo e a pilha, mas não a mensagem da exceção.
    [record] = [item for item in caplog.records if item.name == "contai.errors"]
    logged = json.loads(JsonFormatter().format(record))
    assert logged["exc_type"] == "RuntimeError"
    assert any("in boom" in frame for frame in logged["stack"])
    assert "senha" not in json.dumps(logged)


async def test_every_response_has_request_id_and_security_headers(api: AsyncClient) -> None:
    first = await api.get("/api/v1/health/worker")
    second = await api.get("/missing")

    assert first.headers["X-Request-ID"] != second.headers["X-Request-ID"]
    for response in (first, second):
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert response.headers["Content-Security-Policy"] == (
            "default-src 'none'; frame-ancestors 'none'"
        )
        assert "Strict-Transport-Security" not in response.headers


PROXY_SECRET = "p" * 64


def _production_settings(**overrides: str) -> Settings:
    values = {
        "environment": "production",
        "database_url": "postgresql+asyncpg://u:p@db/contai",
        "app_origin": "https://contai.example",
        "jwt_secret": "x" * 64,
        "totp_encryption_key": "chave",
        "proxy_shared_secret": PROXY_SECRET,
        "scheduler_token": "t" * 64,
        "smtp_host": "smtp.example",
        "email_from": "Contaí <nao-responda@contai.example>",
        **overrides,
    }
    return Settings(**values)  # type: ignore[arg-type]


async def test_production_adds_hsts_and_hides_the_docs() -> None:
    app = create_app(_production_settings())
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        # Em produção, só passa o que veio pelo proxy da Vercel, com o segredo.
        headers={PROXY_SECRET_HEADER: PROXY_SECRET},
    ) as client:
        missing = await client.get("/nao-existe")
        docs = await client.get("/api/docs")
        openapi = await client.get("/api/openapi.json")

    assert missing.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert docs.status_code == 404
    assert openapi.status_code == 404


async def test_docs_are_available_in_development(api: AsyncClient) -> None:
    docs = await api.get("/api/docs")
    openapi = await api.get("/api/openapi.json")

    assert docs.status_code == 200
    assert openapi.json()["info"]["title"] == "Contaí"
    # A página de documentação carrega os próprios scripts, então fica sem a política restrita.
    assert "Content-Security-Policy" not in docs.headers


async def test_cors_is_off_by_default_and_restricted_when_configured() -> None:
    default_app = create_app()
    restricted = create_app(_production_settings(cors_allowed_origins="https://app.example"))
    preflight = {"Origin": "https://app.example", "Access-Control-Request-Method": "GET"}

    async with AsyncClient(transport=ASGITransport(app=default_app), base_url="http://test") as c:
        without_cors = await c.options("/api/v1/health", headers=preflight)
    async with AsyncClient(transport=ASGITransport(app=restricted), base_url="http://test") as c:
        allowed = await c.options("/api/v1/health", headers=preflight)
        denied = await c.options(
            "/api/v1/health", headers={**preflight, "Origin": "https://evil.example"}
        )

    assert "access-control-allow-origin" not in without_cors.headers
    assert allowed.headers["access-control-allow-origin"] == "https://app.example"
    assert "access-control-allow-origin" not in denied.headers
