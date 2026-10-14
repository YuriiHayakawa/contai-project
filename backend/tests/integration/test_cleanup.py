"""Limpeza periódica de tokens, sessões e jobs antigos (T212).

Apaga tokens de e-mail vencidos, sessões expiradas ou revogadas há mais de 30 dias e jobs
concluídos há mais de uma semana, preservando o que ainda está em uso.
"""

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.modules.auth.models import EmailToken, EmailTokenType, Session, SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User
from app.worker.jobs.cleanup import cleanup_expired_auth_and_jobs
from app.worker.models import Job, JobStatus, JobType
from app.worker.repository import WorkerRepository


async def test_cleanup_removes_expired_data_and_keeps_the_rest(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    now = clock.utcnow()
    auth = AuthRepository(session)

    expired_token = await auth.create_email_token(
        user_id=user_a.id,
        token_type=EmailTokenType.PASSWORD_RESET,
        token_hash="hash-expirado",
        expires_at=now - timedelta(hours=1),
    )
    fresh_token = await auth.create_email_token(
        user_id=user_a.id,
        token_type=EmailTokenType.PASSWORD_RESET,
        token_hash="hash-fresco",
        expires_at=now + timedelta(hours=1),
    )

    expired_session = await auth.create_session(
        user_id=user_a.id,
        refresh_token_hash="r1",
        user_agent="x",
        ip="127.0.0.1",
        now=now,
        expires_at=now - timedelta(days=1),
    )
    active_session = await auth.create_session(
        user_id=user_a.id,
        refresh_token_hash="r2",
        user_agent="x",
        ip="127.0.0.1",
        now=now,
        expires_at=now + timedelta(days=30),
    )
    old_revoked = await auth.create_session(
        user_id=user_a.id,
        refresh_token_hash="r3",
        user_agent="x",
        ip="127.0.0.1",
        now=now,
        expires_at=now + timedelta(days=30),
    )
    await session.execute(
        update(Session)
        .where(Session.id == old_revoked.id)
        .values(revoked_at=now - timedelta(days=31), revoked_reason=SessionRevokedReason.LOGOUT)
    )

    worker = WorkerRepository(session)
    old_job = await worker.enqueue(job_type=JobType.SEND_EMAIL, payload={}, run_at=now)
    await session.execute(
        update(Job)
        .where(Job.id == old_job.id)
        .values(status=JobStatus.SUCCEEDED, updated_at=now - timedelta(days=8))
    )
    recent_job = await worker.enqueue(job_type=JobType.SEND_EMAIL, payload={}, run_at=now)
    await session.execute(
        update(Job)
        .where(Job.id == recent_job.id)
        .values(status=JobStatus.SUCCEEDED, updated_at=now)
    )

    # Os ids são lidos antes da limpeza: depois dela, tocar numa instância apagada acionaria IO.
    expired_token_id, fresh_token_id = expired_token.id, fresh_token.id
    expired_session_id, active_session_id = expired_session.id, active_session.id
    old_revoked_id = old_revoked.id
    old_job_id, recent_job_id = old_job.id, recent_job.id

    await cleanup_expired_auth_and_jobs(session)

    tokens = set((await session.execute(select(EmailToken.id))).scalars())
    sessions = set((await session.execute(select(Session.id))).scalars())
    jobs = set((await session.execute(select(Job.id))).scalars())

    assert expired_token_id not in tokens
    assert fresh_token_id in tokens
    assert expired_session_id not in sessions
    assert active_session_id in sessions
    assert old_revoked_id not in sessions
    assert old_job_id not in jobs
    assert recent_job_id in jobs
