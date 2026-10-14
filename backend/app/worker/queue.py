"""Regras da fila de jobs: quando tentar de novo, quando desistir e quando um job travou.

O acesso ao banco fica em `worker/repository.py`; este módulo só decide.
"""

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.worker.models import Job, JobType
from app.worker.repository import WorkerRepository

BASE_DELAY = timedelta(seconds=30)
MAX_DELAY = timedelta(hours=1)
MAX_DOUBLINGS = 16  # além disso a espera já está no teto
JITTER = 0.2
STUCK_AFTER = timedelta(minutes=10)

_random = secrets.SystemRandom()


class JobError(Exception):
    """Falha de um job, com um código que pode ir para os logs e para o banco."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class RetryableJobError(JobError):
    """Falha passageira: o job volta para a fila, com espera.

    `delay` substitui a espera calculada, por exemplo quando o provedor diz quanto esperar.
    """

    def __init__(self, code: str, delay: timedelta | None = None) -> None:
        super().__init__(code)
        self.delay = delay


class PermanentJobError(JobError):
    """Falha definitiva: tentar de novo não adianta."""


def backoff_delay(attempt: int) -> timedelta:
    """Espera antes da próxima tentativa: dobra a cada vez, com variação de até 20%."""
    doublings = min(max(attempt - 1, 0), MAX_DOUBLINGS)
    delay = min(BASE_DELAY * (1 << doublings), MAX_DELAY)
    return delay * _random.uniform(1 - JITTER, 1 + JITTER)


async def enqueue(
    session: AsyncSession,
    job_type: JobType,
    payload: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
    run_at: datetime | None = None,
    max_attempts: int = 5,
) -> Job:
    return await WorkerRepository(session).enqueue(
        job_type=job_type,
        payload=payload,
        user_id=user_id,
        run_at=run_at or clock.utcnow(),
        max_attempts=max_attempts,
    )


async def claim(session: AsyncSession) -> Job | None:
    return await WorkerRepository(session).claim_next(clock.utcnow())


async def complete(session: AsyncSession, job: Job) -> None:
    await WorkerRepository(session).mark_succeeded(job.id)


async def fail(session: AsyncSession, job: Job, error: JobError) -> bool:
    """Registra a falha: nova tentativa com espera, ou falha definitiva.

    Devolve `True` quando a fila desistiu do job: o erro é definitivo ou as tentativas
    acabaram.
    """
    repository = WorkerRepository(session)
    if isinstance(error, PermanentJobError) or job.attempts >= job.max_attempts:
        await repository.mark_failed(job.id, error.code)
        return True
    delay = error.delay if isinstance(error, RetryableJobError) and error.delay else None
    run_at = clock.utcnow() + (delay or backoff_delay(job.attempts))
    await repository.reschedule(job.id, run_at, error.code)
    return False


async def recover_stuck(session: AsyncSession) -> int:
    return await WorkerRepository(session).requeue_stuck(clock.utcnow() - STUCK_AFTER)


# Jobs concluídos (ou que desistiram) são guardados por um tempo para auditoria; depois saem.
FINISHED_JOB_RETENTION = timedelta(days=7)


async def purge_finished(session: AsyncSession) -> int:
    """Apaga os jobs concluídos ou com falha definitiva há mais de uma semana."""
    cutoff = clock.utcnow() - FINISHED_JOB_RETENTION
    return await WorkerRepository(session).delete_finished_before(cutoff)
