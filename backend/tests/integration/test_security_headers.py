"""Cabeçalhos de segurança em todas as respostas da API (T213).

A API só devolve JSON: a política de conteúdo é a mais restrita possível, e o HSTS entra só em
produção, onde o tráfego é sempre HTTPS.
"""

from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import TEST_BASE_URL


async def test_responses_carry_the_security_headers(client: AsyncClient) -> None:
    # Mesmo uma resposta de erro passa pelo middleware e leva os cabeçalhos.
    response = await client.get("/api/v1/users/me")
    assert response.status_code == 401
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    # Nada da API vai para cache, nem no navegador nem no CDN da Vercel.
    assert response.headers["cache-control"] == "no-store"
    csp = response.headers["content-security-policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # Fora de produção não há HSTS: o desenvolvimento roda em HTTP.
    assert "strict-transport-security" not in response.headers


async def test_hsts_is_added_in_production() -> None:
    settings = Settings(
        environment="production",
        totp_encryption_key="chave-de-teste-producao",
        proxy_shared_secret="p" * 64,
    )
    production_app = create_app(settings)
    transport = ASGITransport(app=production_app)
    async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as client:
        # Um caminho inexistente responde 404 sem tocar no banco, mas ainda leva os cabeçalhos.
        response = await client.get("/caminho-inexistente")
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert "default-src 'none'" in response.headers["content-security-policy"]
