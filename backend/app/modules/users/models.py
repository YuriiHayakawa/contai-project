"""Modelo do usuário."""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class UserStatus(StrEnum):
    ACTIVE = "active"
    PENDING_DELETION = "pending_deletion"


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("status IN ('active', 'pending_deletion')", name="status_valid"),
    )

    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[UserStatus] = mapped_column(String(20), server_default=UserStatus.ACTIVE.value)
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    totp_secret_encrypted: Mapped[str | None] = mapped_column(String(255))
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_used_step: Mapped[int | None] = mapped_column(Integer)

    failed_login_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    privacy_policy_version: Mapped[str] = mapped_column(String(20))
    privacy_policy_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ai_documents_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
