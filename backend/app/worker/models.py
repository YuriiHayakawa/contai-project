"""Modelos da fila de jobs e do batimento do worker."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class JobType(StrEnum):
    PROCESS_IMPORT = "process_import"
    SEND_EMAIL = "send_email"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class Job(UUIDPrimaryKey, Timestamps, Base):
    """Um trabalho da fila. O payload traz só identificadores e tipos, nunca conteúdo."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint("type IN ('process_import', 'send_email')", name="type_valid"),
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')", name="status_valid"
        ),
        Index("ix_jobs_run_at_queued", "run_at", postgresql_where=text("status = 'queued'")),
        Index("ix_jobs_user_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[JobType] = mapped_column(String(30))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[JobStatus] = mapped_column(String(20), server_default=JobStatus.QUEUED.value)
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    max_attempts: Mapped[int] = mapped_column(Integer, server_default=text("5"))
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(50))


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"

    worker_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
