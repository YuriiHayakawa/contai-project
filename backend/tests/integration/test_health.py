from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import health
from app.worker.repository import WorkerRepository


async def test_api_health_is_public_and_ok_with_database(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_api_health_is_unavailable_without_database(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def database_down(session: AsyncSession) -> bool:
        return False

    monkeypatch.setattr(health, "ping", database_down)

    response = await client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


async def test_worker_health_is_unavailable_without_heartbeat(
    client: AsyncClient, frozen_time: datetime
) -> None:
    response = await client.get("/api/v1/health/worker")

    assert response.status_code == 503


@pytest.mark.parametrize(("age_seconds", "status"), [(0, 200), (59, 200), (60, 503), (600, 503)])
async def test_worker_health_follows_heartbeat_age(
    client: AsyncClient,
    session: AsyncSession,
    frozen_time: datetime,
    age_seconds: int,
    status: int,
) -> None:
    await WorkerRepository(session).record_heartbeat(
        "worker-1", frozen_time - timedelta(seconds=age_seconds)
    )
    await session.commit()

    response = await client.get("/api/v1/health/worker")

    assert response.status_code == status
