"""Modelo do registro de uso de IA."""

import uuid
from datetime import date
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAt, UUIDPrimaryKey


class AiTask(StrEnum):
    CHAT = "chat"
    TEXT_ENTRY = "text_entry"
    CATEGORIZATION = "categorization"
    STATEMENT_EXTRACTION = "statement_extraction"
    RECEIPT_EXTRACTION = "receipt_extraction"


class AiUsage(UUIDPrimaryKey, CreatedAt, Base):
    """Uma chamada ao provedor de IA: quem, para quê e quantos tokens."""

    __tablename__ = "ai_usage"
    __table_args__ = (
        CheckConstraint(
            "task IN ('chat', 'text_entry', 'categorization', 'statement_extraction', "
            "'receipt_extraction')",
            name="task_valid",
        ),
        Index("ix_ai_usage_user_id_usage_date", "user_id", "usage_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    task: Mapped[AiTask] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(100))
    input_tokens: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    output_tokens: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    counts_toward_limit: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    usage_date: Mapped[date] = mapped_column(Date)
