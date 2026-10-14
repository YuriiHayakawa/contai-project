"""Processo worker: consome a fila de jobs e roda as tarefas periódicas.

Os handlers e as tarefas periódicas chamam serviços dos módulos; nenhum deles consulta o banco
diretamente.
"""

import asyncio
import logging
import os
import signal
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import SessionFactory, session_scope
from app.core.logging import configure_logging
from app.worker import queue
from app.worker.models import Job, JobType
from app.worker.repository import WorkerRepository

POLL_INTERVAL_SECONDS = 2.0
HEARTBEAT_INTERVAL = timedelta(seconds=15)
STUCK_CHECK_INTERVAL = timedelta(minutes=1)
LOGIN_ATTEMPT_PURGE_INTERVAL = timedelta(hours=1)
IMPORT_CLEANUP_INTERVAL = timedelta(minutes=10)
# Tokens vencidos, sessões antigas e jobs concluídos não têm pressa: uma vez por hora basta.
EXPIRED_DATA_CLEANUP_INTERVAL = timedelta(hours=1)
# A desativação da verificação em duas etapas tem prazo de 72 horas: conferir de hora em hora
# dá folga de sobra para o lembrete de 24 horas antes e para aplicar no fim do prazo.
TWO_FACTOR_RESET_INTERVAL = timedelta(minutes=30)
# A exclusão de conta tem prazo de 7 dias: conferir de hora em hora é mais que suficiente.
ACCOUNT_DELETION_INTERVAL = timedelta(hours=1)
UNEXPECTED_ERROR_CODE = "unexpected_error"

JobHandler = Callable[[AsyncSession, Job], Awaitable[None]]
PeriodicTask = Callable[[AsyncSession], Awaitable[None]]

logger = logging.getLogger("contai.worker")


@dataclass
class _Periodic:
    name: str
    interval: timedelta
    run: PeriodicTask
    last_run_at: datetime | None = None

    def is_due(self, now: datetime) -> bool:
        return self.last_run_at is None or now - self.last_run_at >= self.interval


@dataclass
class Worker:
    """Registro de handlers e de tarefas periódicas, e o laço que os executa."""

    session_factory: SessionFactory = session_scope
    worker_id: str = field(default_factory=lambda: f"{socket.gethostname()}-{os.getpid()}")
    _handlers: dict[JobType, JobHandler] = field(default_factory=dict)
    _give_up_handlers: dict[JobType, JobHandler] = field(default_factory=dict)
    _periodic: list[_Periodic] = field(default_factory=list)

    def register_handler(self, job_type: JobType, handler: JobHandler) -> None:
        self._handlers[job_type] = handler

    def register_give_up_handler(self, job_type: JobType, handler: JobHandler) -> None:
        """Registra o que fazer quando a fila desiste de um job deste tipo."""
        self._give_up_handlers[job_type] = handler

    def register_periodic(self, name: str, interval: timedelta, task: PeriodicTask) -> None:
        self._periodic.append(_Periodic(name=name, interval=interval, run=task))

    async def process_next_job(self) -> bool:
        """Processa um job, se houver. Devolve `True` quando havia trabalho."""
        async with self.session_factory() as session:
            job = await queue.claim(session)
        if job is None:
            return False

        log_fields = {"job_id": str(job.id), "job_type": job.type, "attempt": job.attempts}
        handler = self._handlers.get(JobType(job.type))
        try:
            if handler is None:
                raise queue.PermanentJobError("no_handler")
            async with self.session_factory() as session:
                await handler(session, job)
        except queue.JobError as error:
            await self._record_failure(job, error)
            logger.warning("job failed", extra={**log_fields, "error_code": error.code})
        except Exception:
            await self._record_failure(job, queue.RetryableJobError(UNEXPECTED_ERROR_CODE))
            logger.exception("job crashed", extra=log_fields)
        else:
            async with self.session_factory() as session:
                await queue.complete(session, job)
            logger.info("job succeeded", extra=log_fields)
        return True

    async def _record_failure(self, job: Job, error: queue.JobError) -> None:
        async with self.session_factory() as session:
            gave_up = await queue.fail(session, job, error)
        handler = self._give_up_handlers.get(JobType(job.type))
        if not gave_up or handler is None:
            return
        try:
            async with self.session_factory() as session:
                await handler(session, job)
        except Exception:
            logger.exception("give-up handler crashed", extra={"job_id": str(job.id)})

    async def run_periodic_tasks(self) -> None:
        now = clock.utcnow()
        for periodic in self._periodic:
            if not periodic.is_due(now):
                continue
            periodic.last_run_at = now
            try:
                async with self.session_factory() as session:
                    await periodic.run(session)
            except Exception:
                logger.exception("periodic task crashed", extra={"job_type": periodic.name})

    async def run(self, stop: asyncio.Event) -> None:
        logger.info("worker started", extra={"worker_id": self.worker_id})
        while not stop.is_set():
            try:
                await self.run_periodic_tasks()
                had_work = await self.process_next_job()
            except Exception:
                # Falha de infraestrutura (por exemplo, banco fora do ar): espera e tenta de novo.
                logger.exception("worker loop error", extra={"worker_id": self.worker_id})
                had_work = False
            if not had_work:
                await _wait(stop, POLL_INTERVAL_SECONDS)
        logger.info("worker stopped", extra={"worker_id": self.worker_id})


async def _wait(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        return


def build_worker(session_factory: SessionFactory = session_scope) -> Worker:
    """Monta o worker com tudo que ele executa."""
    # Importar os módulos registra os tipos de e-mail que o job sabe enviar.
    from app.modules.auth import emails as _auth_emails  # noqa: F401
    from app.modules.users import emails as _user_emails  # noqa: F401
    from app.worker.jobs.account_deletion import purge_due_account_deletions
    from app.worker.jobs.cleanup import cleanup_expired_auth_and_jobs, cleanup_imports
    from app.worker.jobs.login_attempts import purge_login_attempts
    from app.worker.jobs.process_import import handle_import_given_up, handle_process_import
    from app.worker.jobs.send_email import handle_send_email
    from app.worker.jobs.two_factor_reset import (
        apply_due_two_factor_resets,
        send_two_factor_reset_reminders,
    )

    worker = Worker(session_factory=session_factory)
    worker.register_handler(JobType.SEND_EMAIL, handle_send_email)
    worker.register_handler(JobType.PROCESS_IMPORT, handle_process_import)
    worker.register_give_up_handler(JobType.PROCESS_IMPORT, handle_import_given_up)
    worker.register_periodic("heartbeat", HEARTBEAT_INTERVAL, _heartbeat_task(worker))
    worker.register_periodic("recover_stuck_jobs", STUCK_CHECK_INTERVAL, _recover_stuck)
    worker.register_periodic(
        "purge_login_attempts", LOGIN_ATTEMPT_PURGE_INTERVAL, purge_login_attempts
    )
    worker.register_periodic("cleanup_imports", IMPORT_CLEANUP_INTERVAL, cleanup_imports)
    worker.register_periodic(
        "cleanup_expired_auth_and_jobs",
        EXPIRED_DATA_CLEANUP_INTERVAL,
        cleanup_expired_auth_and_jobs,
    )
    worker.register_periodic(
        "two_factor_reset_reminders", TWO_FACTOR_RESET_INTERVAL, send_two_factor_reset_reminders
    )
    worker.register_periodic(
        "apply_two_factor_resets", TWO_FACTOR_RESET_INTERVAL, apply_due_two_factor_resets
    )
    worker.register_periodic(
        "purge_account_deletions", ACCOUNT_DELETION_INTERVAL, purge_due_account_deletions
    )
    return worker


def _heartbeat_task(worker: Worker) -> PeriodicTask:
    async def beat(session: AsyncSession) -> None:
        await WorkerRepository(session).record_heartbeat(worker.worker_id, clock.utcnow())

    return beat


async def _recover_stuck(session: AsyncSession) -> None:
    recovered = await queue.recover_stuck(session)
    if recovered:
        logger.warning("stuck jobs requeued", extra={"count": recovered})


async def main() -> None:
    configure_logging()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await build_worker().run(stop)


if __name__ == "__main__":
    asyncio.run(main())
