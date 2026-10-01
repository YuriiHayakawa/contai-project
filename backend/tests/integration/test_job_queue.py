from collections.abc import AsyncIterator
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core import clock
from app.modules.users.models import User
from app.worker import queue
from app.worker.models import Job, JobStatus, JobType
from app.worker.repository import WorkerRepository

PAYLOAD = {"email_type": "x", "user_id": "y"}


async def _enqueue(session: AsyncSession, **kwargs: object) -> Job:
    return await queue.enqueue(session, JobType.SEND_EMAIL, PAYLOAD, **kwargs)  # type: ignore[arg-type]


async def test_enqueue_and_claim(session: AsyncSession, frozen_time: datetime) -> None:
    job = await _enqueue(session)

    assert job.status == JobStatus.QUEUED
    assert job.attempts == 0
    assert job.payload == PAYLOAD

    claimed = await queue.claim(session)

    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == JobStatus.RUNNING
    assert claimed.attempts == 1
    assert claimed.locked_at == frozen_time
    assert await queue.claim(session) is None


async def test_job_scheduled_for_later_is_not_claimed(
    session: AsyncSession, frozen_time: datetime
) -> None:
    job = await _enqueue(session, run_at=frozen_time + timedelta(minutes=5))

    assert await queue.claim(session) is None

    clock.set_fixed_time(frozen_time + timedelta(minutes=5))
    claimed = await queue.claim(session)

    assert claimed is not None
    assert claimed.id == job.id


async def test_jobs_are_claimed_in_schedule_order(
    session: AsyncSession, frozen_time: datetime
) -> None:
    later = await _enqueue(session, run_at=frozen_time - timedelta(minutes=1))
    earlier = await _enqueue(session, run_at=frozen_time - timedelta(minutes=10))

    first = await queue.claim(session)
    second = await queue.claim(session)

    assert first is not None and first.id == earlier.id
    assert second is not None and second.id == later.id


async def test_complete_marks_job_succeeded(session: AsyncSession, frozen_time: datetime) -> None:
    await _enqueue(session)
    job = await queue.claim(session)
    assert job is not None

    await queue.complete(session, job)
    await session.refresh(job)

    assert job.status == JobStatus.SUCCEEDED
    assert job.locked_at is None


async def test_retryable_failure_reschedules_with_backoff(
    session: AsyncSession, frozen_time: datetime
) -> None:
    await _enqueue(session)
    job = await queue.claim(session)
    assert job is not None

    await queue.fail(session, job, queue.RetryableJobError("smtp_failed"))
    await session.refresh(job)

    assert job.status == JobStatus.QUEUED
    assert job.last_error_code == "smtp_failed"
    assert job.locked_at is None
    # Primeira tentativa: 30 s, com variação de até 20%.
    assert timedelta(seconds=24) <= job.run_at - frozen_time <= timedelta(seconds=36)


async def test_retryable_failure_honours_delay_given_by_the_error(
    session: AsyncSession, frozen_time: datetime
) -> None:
    await _enqueue(session)
    job = await queue.claim(session)
    assert job is not None

    await queue.fail(
        session, job, queue.RetryableJobError("rate_limited", delay=timedelta(minutes=7))
    )
    await session.refresh(job)

    assert job.run_at == frozen_time + timedelta(minutes=7)


async def test_job_fails_for_good_after_max_attempts(
    session: AsyncSession, frozen_time: datetime
) -> None:
    await _enqueue(session, max_attempts=2)
    job: Job | None = None

    for attempt in (1, 2):
        clock.set_fixed_time(frozen_time + timedelta(hours=attempt))
        job = await queue.claim(session)
        assert job is not None
        await queue.fail(session, job, queue.RetryableJobError("smtp_failed"))
        await session.refresh(job)

    assert job is not None
    assert job.attempts == 2
    assert job.status == JobStatus.FAILED
    assert job.last_error_code == "smtp_failed"
    assert await queue.claim(session) is None


async def test_permanent_failure_does_not_retry(
    session: AsyncSession, frozen_time: datetime
) -> None:
    await _enqueue(session)
    job = await queue.claim(session)
    assert job is not None

    await queue.fail(session, job, queue.PermanentJobError("unknown_email_type"))
    await session.refresh(job)

    assert job.status == JobStatus.FAILED
    assert job.last_error_code == "unknown_email_type"


@pytest.mark.parametrize(
    ("attempt", "base_seconds"), [(1, 30), (2, 60), (3, 120), (4, 240), (20, 3600)]
)
def test_backoff_doubles_and_is_capped(attempt: int, base_seconds: int) -> None:
    for _ in range(50):
        delay = queue.backoff_delay(attempt).total_seconds()

        assert base_seconds * 0.8 <= delay <= base_seconds * 1.2


async def test_stuck_jobs_return_to_the_queue(session: AsyncSession, frozen_time: datetime) -> None:
    await _enqueue(session)
    job = await queue.claim(session)
    assert job is not None

    clock.set_fixed_time(frozen_time + timedelta(minutes=9))
    assert await queue.recover_stuck(session) == 0

    clock.set_fixed_time(frozen_time + timedelta(minutes=11))
    assert await queue.recover_stuck(session) == 1
    await session.refresh(job)

    assert job.status == JobStatus.QUEUED
    assert job.last_error_code == "stuck"
    reclaimed = await queue.claim(session)
    assert reclaimed is not None
    assert reclaimed.attempts == 2


async def test_cancel_pending_jobs_of_one_user_only(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    repository = WorkerRepository(session)
    await _enqueue(session, user_id=user_a.id)
    await _enqueue(session, user_id=user_a.id)
    kept = await _enqueue(session, user_id=user_b.id)

    assert await repository.cancel_pending_for_user(user_a.id) == 2

    remaining = await queue.claim(session)
    assert remaining is not None
    assert remaining.id == kept.id


async def test_delete_finished_jobs_before_cutoff(
    session: AsyncSession, frozen_time: datetime
) -> None:
    repository = WorkerRepository(session)
    await _enqueue(session)
    finished = await queue.claim(session)
    assert finished is not None
    await queue.complete(session, finished)
    pending = await _enqueue(session)
    finished_id, pending_id = finished.id, pending.id

    # `updated_at` vem do relógio do banco, por isso o corte fica no futuro.
    deleted = await repository.delete_finished_before(clock.utcnow() + timedelta(days=3650))

    assert deleted == 1
    session.expire_all()
    assert await repository.get(finished_id) is None
    assert await repository.get(pending_id) is not None


async def test_heartbeat_is_upserted_per_worker(
    session: AsyncSession, frozen_time: datetime
) -> None:
    repository = WorkerRepository(session)
    assert await repository.last_heartbeat() is None

    await repository.record_heartbeat("worker-1", frozen_time)
    await repository.record_heartbeat("worker-2", frozen_time + timedelta(seconds=5))
    await repository.record_heartbeat("worker-1", frozen_time + timedelta(seconds=30))

    assert await repository.last_heartbeat() == frozen_time + timedelta(seconds=30)


# ---------- SKIP LOCKED, com duas conexões de verdade


@pytest_asyncio.fixture
async def committed_job(engine: AsyncEngine) -> AsyncIterator[Job]:
    """Um job gravado de verdade (fora da transação do teste), apagado ao final."""
    async with AsyncSession(engine, expire_on_commit=False) as setup:
        job = await queue.enqueue(setup, JobType.SEND_EMAIL, PAYLOAD)
        await setup.commit()
    yield job
    async with AsyncSession(engine) as cleanup:
        await cleanup.execute(delete(Job).where(Job.id == job.id))
        await cleanup.commit()


async def test_two_workers_never_claim_the_same_job(
    engine: AsyncEngine, committed_job: Job
) -> None:
    async with (
        AsyncSession(engine, expire_on_commit=False) as first_worker,
        AsyncSession(engine, expire_on_commit=False) as second_worker,
    ):
        first = await queue.claim(first_worker)
        # O primeiro worker ainda não confirmou: a linha está travada, e o segundo a pula.
        second = await queue.claim(second_worker)

        assert first is not None
        assert first.id == committed_job.id
        assert second is None

        await first_worker.rollback()
        await second_worker.rollback()
