"""Único ponto de acesso às tabelas da fila (`jobs`) e do batimento (`worker_heartbeats`)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.worker.models import Job, JobStatus, JobType, WorkerHeartbeat


class WorkerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ---------- fila

    async def enqueue(
        self,
        *,
        job_type: JobType,
        payload: dict[str, Any],
        run_at: datetime,
        user_id: uuid.UUID | None = None,
        max_attempts: int = 5,
    ) -> Job:
        job = Job(
            type=job_type,
            payload=payload,
            run_at=run_at,
            user_id=user_id,
            max_attempts=max_attempts,
        )
        self._session.add(job)
        await self._session.flush()
        await self._session.refresh(job)
        return job

    async def get(self, job_id: uuid.UUID) -> Job | None:
        return await self._session.get(Job, job_id)

    async def claim_next(self, now: datetime) -> Job | None:
        """Reserva o próximo job pronto. `SKIP LOCKED` impede dois workers no mesmo job."""
        result = await self._session.execute(
            select(Job)
            .where(Job.status == JobStatus.QUEUED, Job.run_at <= now)
            .order_by(Job.run_at, Job.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return None
        job.status = JobStatus.RUNNING
        job.locked_at = now
        job.attempts += 1
        await self._session.flush()
        return job

    async def mark_succeeded(self, job_id: uuid.UUID) -> None:
        await self._session.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(status=JobStatus.SUCCEEDED, locked_at=None, last_error_code=None)
        )

    async def mark_failed(self, job_id: uuid.UUID, error_code: str) -> None:
        await self._session.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(status=JobStatus.FAILED, locked_at=None, last_error_code=error_code[:50])
        )

    async def reschedule(self, job_id: uuid.UUID, run_at: datetime, error_code: str) -> None:
        await self._session.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(
                status=JobStatus.QUEUED,
                run_at=run_at,
                locked_at=None,
                last_error_code=error_code[:50],
            )
        )

    async def requeue_stuck(self, locked_before: datetime) -> int:
        """Devolve à fila os jobs reservados há tempo demais (o worker morreu no meio)."""
        result = await self._session.execute(
            update(Job)
            .where(Job.status == JobStatus.RUNNING, Job.locked_at < locked_before)
            .values(status=JobStatus.QUEUED, locked_at=None, last_error_code="stuck")
            .returning(Job.id)
        )
        return len(result.scalars().all())

    async def cancel_pending_for_user(self, user_id: uuid.UUID) -> int:
        result = await self._session.execute(
            delete(Job)
            .where(Job.user_id == user_id, Job.status == JobStatus.QUEUED)
            .returning(Job.id)
        )
        return len(result.scalars().all())

    async def delete_finished_before(self, cutoff: datetime) -> int:
        result = await self._session.execute(
            delete(Job)
            .where(
                Job.status.in_([JobStatus.SUCCEEDED, JobStatus.FAILED]),
                Job.updated_at < cutoff,
            )
            .returning(Job.id)
        )
        return len(result.scalars().all())

    # ---------- batimento

    async def record_heartbeat(self, worker_id: str, now: datetime) -> None:
        statement = insert(WorkerHeartbeat).values(worker_id=worker_id, last_seen_at=now)
        await self._session.execute(
            statement.on_conflict_do_update(
                index_elements=[WorkerHeartbeat.worker_id], set_={"last_seen_at": now}
            )
        )

    async def last_heartbeat(self) -> datetime | None:
        result = await self._session.execute(
            select(WorkerHeartbeat.last_seen_at)
            .order_by(WorkerHeartbeat.last_seen_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def try_lock(self, key: int) -> bool:
        """Pega a trava `key` até o fim da transação, sem esperar: `False` se já está com outro.

        Usada nas tarefas periódicas, que o laço do worker e o disparo externo podem rodar ao
        mesmo tempo.
        """
        result = await self._session.execute(select(func.pg_try_advisory_xact_lock(key)))
        return bool(result.scalar_one())
