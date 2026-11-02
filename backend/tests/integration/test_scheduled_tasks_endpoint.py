"""O disparo externo das tarefas agendadas (T261): token, resultado por tarefa e trava."""

from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.database import SessionFactory, get_session_factory
from app.main import app
from app.worker import router as worker_router
from app.worker.main import Worker, lock_key
from app.worker.repository import WorkerRepository
from tests.conftest import TEST_DATABASE_URL

SCHEDULED_TASKS = "/api/v1/internal/scheduled-tasks"
TOKEN = "t" * 64
AUTHORIZATION = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def scheduler_token(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(get_settings(), "scheduler_token", SecretStr(TOKEN))
    yield


@pytest_asyncio.fixture
async def internal(
    client: AsyncClient, session_factory: SessionFactory
) -> AsyncIterator[AsyncClient]:
    """O cliente, com as tarefas rodando nas sessões presas à transação do teste."""
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    yield client
    app.dependency_overrides.pop(get_session_factory, None)


async def test_without_a_configured_token_the_route_does_not_exist(
    internal: AsyncClient,
) -> None:
    response = await internal.post(SCHEDULED_TASKS, headers=AUTHORIZATION)

    assert response.status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer errado"},
        {"Authorization": TOKEN},
        {"Authorization": "Basic x"},
    ],
)
@pytest.mark.usefixtures("scheduler_token")
async def test_a_missing_or_wrong_token_is_refused(
    internal: AsyncClient, headers: dict[str, str]
) -> None:
    response = await internal.post(SCHEDULED_TASKS, headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


@pytest.mark.usefixtures("scheduler_token")
async def test_every_periodic_task_runs_once_and_reports_how_it_went(
    internal: AsyncClient, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    response = await internal.post(SCHEDULED_TASKS, headers=AUTHORIZATION)

    assert response.status_code == 200, response.text
    # Todas as tarefas periódicas, menos o batimento do laço.
    assert {task["name"] for task in response.json()["tasks"]} == {
        "recover_stuck_jobs",
        "purge_login_attempts",
        "cleanup_imports",
        "cleanup_expired_auth_and_jobs",
        "two_factor_reset_reminders",
        "apply_two_factor_resets",
        "purge_account_deletions",
    }
    assert {task["status"] for task in response.json()["tasks"]} == {"ok"}


@pytest.mark.usefixtures("scheduler_token")
async def test_a_failed_task_makes_the_answer_503_and_the_others_still_run(
    internal: AsyncClient,
    session_factory: SessionFactory,
    frozen_time: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ran: list[str] = []

    async def broken(session: AsyncSession) -> None:
        raise RuntimeError("detalhe que não pode chegar à resposta")

    async def fine(session: AsyncSession) -> None:
        ran.append("fine")

    def two_tasks(factory: SessionFactory) -> Worker:
        worker = Worker(session_factory=factory)
        worker.register_periodic("broken", timedelta(hours=1), broken)
        worker.register_periodic("fine", timedelta(hours=1), fine)
        return worker

    monkeypatch.setattr(worker_router, "build_worker", two_tasks)

    response = await internal.post(SCHEDULED_TASKS, headers=AUTHORIZATION)

    assert response.status_code == 503
    assert response.json() == {
        "tasks": [{"name": "broken", "status": "failed"}, {"name": "fine", "status": "ok"}]
    }
    assert ran == ["fine"]


@pytest.mark.usefixtures("scheduler_token")
async def test_the_route_is_rate_limited(
    internal: AsyncClient, frozen_time: datetime, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_tasks(factory: SessionFactory) -> Worker:
        return Worker(session_factory=factory)

    monkeypatch.setattr(worker_router, "build_worker", no_tasks)

    statuses = [
        (await internal.post(SCHEDULED_TASKS, headers=AUTHORIZATION)).status_code for _ in range(11)
    ]

    assert statuses == [200] * 10 + [429]


async def test_a_task_whose_lock_is_taken_is_skipped(
    session_factory: SessionFactory, frozen_time: datetime, monkeypatch: pytest.MonkeyPatch
) -> None:
    ran: list[str] = []

    async def task(session: AsyncSession) -> None:
        ran.append("task")

    async def taken(repository: WorkerRepository, key: int) -> bool:
        return False

    worker = Worker(session_factory=session_factory)
    worker.register_periodic("task", timedelta(hours=1), task)
    monkeypatch.setattr(WorkerRepository, "try_lock", taken)

    [result] = await worker.run_scheduled_tasks()
    await worker.run_periodic_tasks()

    assert (result.name, result.status) == ("task", "skipped")
    assert ran == []


async def test_the_lock_is_exclusive_until_the_transaction_ends() -> None:
    # Duas conexões próprias: nos outros testes, as sessões dividem uma conexão só.
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    key = lock_key("teste-da-trava")
    try:
        async with AsyncSession(engine) as first, AsyncSession(engine) as second:
            assert await WorkerRepository(first).try_lock(key) is True
            assert await WorkerRepository(second).try_lock(key) is False
            await second.rollback()

            await first.commit()

            assert await WorkerRepository(second).try_lock(key) is True
            await second.rollback()
    finally:
        await engine.dispose()
