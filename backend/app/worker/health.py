"""Checagem de saúde do worker.

O worker está saudável se o último batimento gravado tem menos de 60 segundos. A mesma regra
serve ao `healthcheck` do contêiner (`python -m app.worker.health`) e a `/api/v1/health/worker`.
"""

import asyncio
import sys
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import session_scope
from app.worker.repository import WorkerRepository

MAX_HEARTBEAT_AGE = timedelta(seconds=60)


async def is_healthy(session: AsyncSession) -> bool:
    last_seen_at = await WorkerRepository(session).last_heartbeat()
    return last_seen_at is not None and clock.utcnow() - last_seen_at < MAX_HEARTBEAT_AGE


async def _check() -> bool:
    try:
        async with session_scope() as session:
            return await is_healthy(session)
    except Exception:
        return False


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(_check()) else 1)
