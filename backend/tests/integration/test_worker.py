"""O laço do worker: execução de handlers, falhas e tarefas periódicas."""

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import SessionFactory
from app.worker import queue
from app.worker.main import Worker, build_worker
from app.worker.models import Job, JobStatus, JobType
from app.worker.repository import WorkerRepository


async def _enqueue(session: AsyncSession, job_type: JobType = JobType.SEND_EMAIL) -> Job:
    job = await queue.enqueue(session, job_type, {"n": 1})
    await session.commit()
    return job


async def test_no_job_means_no_work(session_factory: SessionFactory, frozen_time: datetime) -> None:
    assert await Worker(session_factory=session_factory).process_next_job() is False


async def test_handler_runs_and_job_succeeds(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    seen: list[Job] = []

    async def handler(handler_session: AsyncSession, job: Job) -> None:
        seen.append(job)

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    job = await _enqueue(session)

    assert await worker.process_next_job() is True
    await session.refresh(job)

    assert [item.id for item in seen] == [job.id]
    assert job.status == JobStatus.SUCCEEDED


async def test_job_error_is_recorded_and_job_is_retried(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    async def handler(handler_session: AsyncSession, job: Job) -> None:
        raise queue.RetryableJobError("smtp_failed")

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    job = await _enqueue(session)

    await worker.process_next_job()
    await session.refresh(job)

    assert job.status == JobStatus.QUEUED
    assert job.last_error_code == "smtp_failed"
    assert job.run_at > frozen_time


async def test_unexpected_crash_is_retried_with_generic_code(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    async def handler(handler_session: AsyncSession, job: Job) -> None:
        raise RuntimeError("detalhe que não pode ir para o banco")

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    job = await _enqueue(session)

    await worker.process_next_job()
    await session.refresh(job)

    assert job.status == JobStatus.QUEUED
    assert job.last_error_code == "unexpected_error"


async def test_work_done_by_a_failing_handler_is_rolled_back(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    async def handler(handler_session: AsyncSession, job: Job) -> None:
        await queue.enqueue(handler_session, JobType.SEND_EMAIL, {"created_by": "handler"})
        raise queue.PermanentJobError("template_error")

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    job = await _enqueue(session)

    await worker.process_next_job()
    await session.refresh(job)

    assert job.status == JobStatus.FAILED
    # O job criado pelo handler foi desfeito junto com a falha: a fila está vazia.
    assert await worker.process_next_job() is False


async def test_job_without_handler_fails_permanently(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    job = await _enqueue(session, JobType.PROCESS_IMPORT)

    await Worker(session_factory=session_factory).process_next_job()
    await session.refresh(job)

    assert job.status == JobStatus.FAILED
    assert job.last_error_code == "no_handler"


async def test_periodic_tasks_respect_their_interval(
    session_factory: SessionFactory, frozen_time: datetime
) -> None:
    runs: list[datetime] = []

    async def task(task_session: AsyncSession) -> None:
        runs.append(clock.utcnow())

    worker = Worker(session_factory=session_factory)
    worker.register_periodic("teste", timedelta(minutes=1), task)

    await worker.run_periodic_tasks()
    await worker.run_periodic_tasks()
    clock.set_fixed_time(frozen_time + timedelta(seconds=59))
    await worker.run_periodic_tasks()
    clock.set_fixed_time(frozen_time + timedelta(seconds=60))
    await worker.run_periodic_tasks()

    assert runs == [frozen_time, frozen_time + timedelta(seconds=60)]


async def test_crashing_periodic_task_does_not_stop_the_others(
    session_factory: SessionFactory, frozen_time: datetime
) -> None:
    ran: list[str] = []

    async def broken(task_session: AsyncSession) -> None:
        raise RuntimeError("falhou")

    async def healthy(task_session: AsyncSession) -> None:
        ran.append("ok")

    worker = Worker(session_factory=session_factory)
    worker.register_periodic("quebrada", timedelta(minutes=1), broken)
    worker.register_periodic("boa", timedelta(minutes=1), healthy)

    await worker.run_periodic_tasks()

    assert ran == ["ok"]


async def test_built_worker_records_heartbeat_and_recovers_stuck_jobs(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    job = await _enqueue(session)
    await queue.claim(session)
    await session.commit()
    clock.set_fixed_time(frozen_time + timedelta(minutes=11))
    worker = build_worker(session_factory)

    await worker.run_periodic_tasks()
    await session.refresh(job)

    assert await WorkerRepository(session).last_heartbeat() == clock.utcnow()
    assert job.status == JobStatus.QUEUED


async def test_give_up_handler_runs_when_the_attempts_run_out(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    given_up: list[int] = []

    async def handler(handler_session: AsyncSession, job: Job) -> None:
        raise queue.RetryableJobError("smtp_failed")

    async def give_up(handler_session: AsyncSession, job: Job) -> None:
        given_up.append(job.attempts)

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    worker.register_give_up_handler(JobType.SEND_EMAIL, give_up)
    job = await queue.enqueue(session, JobType.SEND_EMAIL, {"n": 1}, max_attempts=2)
    await session.commit()

    await worker.process_next_job()
    # Na primeira falha o job volta para a fila: ainda não é hora de desistir.
    assert given_up == []

    clock.set_fixed_time(frozen_time + timedelta(hours=2))
    await worker.process_next_job()
    await session.refresh(job)

    assert given_up == [2]
    assert job.status == JobStatus.FAILED


async def test_give_up_handler_runs_at_once_on_a_permanent_error_and_may_crash(
    session: AsyncSession, session_factory: SessionFactory, frozen_time: datetime
) -> None:
    calls: list[str] = []

    async def handler(handler_session: AsyncSession, job: Job) -> None:
        raise queue.PermanentJobError("invalid_payload")

    async def give_up(handler_session: AsyncSession, job: Job) -> None:
        calls.append("chamado")
        raise RuntimeError("falhou ao avisar")

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handler)
    worker.register_give_up_handler(JobType.SEND_EMAIL, give_up)
    job = await _enqueue(session)

    # A falha de quem avisa não derruba o worker nem muda o destino do job.
    assert await worker.process_next_job() is True
    await session.refresh(job)

    assert calls == ["chamado"]
    assert job.status == JobStatus.FAILED
    assert job.last_error_code == "invalid_payload"
