"""Teste de fumaça do esqueleto: confirma que o app sobe e que as ferramentas de teste funcionam."""

from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health_responds_ok() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
