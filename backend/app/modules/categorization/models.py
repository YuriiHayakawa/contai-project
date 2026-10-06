"""Regra de categorização: a categoria aprendida para uma descrição normalizada (FR-048)."""

import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class RuleSource(StrEnum):
    # Correção do usuário: nunca é substituída por uma sugestão da IA.
    USER = "user"
    # Sugestão da IA guardada, para não perguntar de novo pela mesma descrição.
    AI = "ai"


class CategorizationRule(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "categorization_rules"
    __table_args__ = (
        CheckConstraint("source IN ('user', 'ai')", name="source_valid"),
        Index(
            "uq_categorization_rules_user_id_description_normalized",
            "user_id",
            "description_normalized",
            unique=True,
        ),
        Index("ix_categorization_rules_category_id", "category_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    description_normalized: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    source: Mapped[RuleSource] = mapped_column(String(10))
