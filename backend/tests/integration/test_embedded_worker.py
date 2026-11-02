"""O worker embutido no processo da API (T258, ADR 0010): começa e para com o app."""

import asyncio
from datetime import datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app import main
from app.core.config import Settings
from app.core.database import SessionFactory
from app.worker import embedded
from app.worker.embedded import embedded_worker
from app.worker.main import Worker

WAIT_SECONDS = 5.0


class _Probe:
    """Tarefa periódica que avisa quando começa e pode demorar para terminar."""

    def __init__(self, duration: float = 0.0) -> None:
        self.duration = duration
        self.started = asyncio.Event()
        self.runs = 0
        self.finished = 0

    async def __call__(self, session: AsyncSession) -> None:
        self.runs += 1
        self.started.set()
        await asyncio.sleep(self.duration)
        self.finished += 1


def _worker(session_factory: SessionFactory, probe: _Probe) -> Worker:
    worker = Worker(session_factory=session_factory)
    worker.register_periodic("probe", timedelta(hours=1), probe)
    return worker


async def test_the_worker_runs_in_the_background_until_the_app_stops(
    session_factory: SessionFactory, frozen_time: datetime
) -> None:
    probe = _Probe()

    async with embedded_worker(_worker(session_factory, probe)):
        await asyncio.wait_for(probe.started.wait(), WAIT_SECONDS)

    runs = probe.runs
    await asyncio.sleep(0.1)
    assert probe.runs == runs == 1


async def test_the_job_in_progress_finishes_before_the_app_stops(
    session_factory: SessionFactory, frozen_time: datetime
) -> None:
    probe = _Probe(duration=0.3)

    async with embedded_worker(_worker(session_factory, probe)):
        await asyncio.wait_for(probe.started.wait(), WAIT_SECONDS)

    assert probe.finished == 1


async def test_a_job_past_the_grace_period_is_interrupted(
    session_factory: SessionFactory,
    frozen_time: datetime,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(embedded, "SHUTDOWN_GRACE_SECONDS", 0.1)
    probe = _Probe(duration=30)

    async with embedded_worker(_worker(session_factory, probe)):
        await asyncio.wait_for(probe.started.wait(), WAIT_SECONDS)

    assert probe.finished == 0
    assert "embedded worker stopped before finishing its job" in caplog.text


@pytest.mark.parametrize("worker_embedded", [True, False])
async def test_the_app_starts_the_worker_only_when_embedded(
    session_factory: SessionFactory,
    frozen_time: datetime,
    monkeypatch: pytest.MonkeyPatch,
    worker_embedded: bool,
) -> None:
    probe = _Probe()
    built: list[Worker] = []

    def build_worker() -> Worker:
        built.append(_worker(session_factory, probe))
        return built[-1]

    monkeypatch.setattr(main, "build_worker", build_worker)
    app = main.create_app(Settings(worker_embedded=worker_embedded))

    async with app.router.lifespan_context(app):
        if worker_embedded:
            await asyncio.wait_for(probe.started.wait(), WAIT_SECONDS)

    assert len(built) == (1 if worker_embedded else 0)
    assert probe.runs == (1 if worker_embedded else 0)
