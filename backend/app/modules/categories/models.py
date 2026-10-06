"""Modelo de categoria, em dois níveis: categoria e subcategoria."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class CategoryKind(StrEnum):
    EXPENSE = "expense"
    INCOME = "income"


class CategoryColor(StrEnum):
    """As cores de categoria do design system (seção 2.3). O banco guarda o nome do token."""

    TINTA = "tinta"
    CAQUI = "caqui"
    PISCINA = "piscina"
    MOSTARDA = "mostarda"
    GOIABA = "goiaba"
    MATA = "mata"
    AMEIXA = "ameixa"
    PITANGA = "pitanga"
    # Neutra: reservada à categoria "Outros"; não aparece na escolha do usuário.
    ARDOSIA = "ardosia"


SELECTABLE_COLORS = frozenset(color for color in CategoryColor if color != CategoryColor.ARDOSIA)

_KINDS = ", ".join(repr(item.value) for item in CategoryKind)
_COLORS = ", ".join(repr(item.value) for item in CategoryColor)


class Category(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint(f"kind IN ({_KINDS})", name="kind_valid"),
        CheckConstraint(f"color IN ({_COLORS})", name="color_valid"),
        CheckConstraint("char_length(name) BETWEEN 1 AND 40", name="name_length"),
        CheckConstraint("color <> 'ardosia' OR is_fallback", name="neutral_color_only_fallback"),
        CheckConstraint("NOT is_fallback OR parent_id IS NULL", name="fallback_is_top_level"),
        CheckConstraint("NOT is_fallback OR archived_at IS NULL", name="fallback_never_archived"),
        Index("ix_categories_user_id", "user_id"),
        Index("ix_categories_parent_id", "parent_id"),
        # O nome é único entre irmãs ativas: entre as principais de um tipo e entre as
        # subcategorias de uma mesma categoria.
        Index(
            "uq_categories_user_id_kind_name_top_level_active",
            "user_id",
            "kind",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NULL AND archived_at IS NULL"),
        ),
        Index(
            "uq_categories_parent_id_name_active",
            "parent_id",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NOT NULL AND archived_at IS NULL"),
        ),
        # Uma "Outros" por tipo.
        Index(
            "uq_categories_user_id_kind_fallback",
            "user_id",
            "kind",
            unique=True,
            postgresql_where=text("is_fallback"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(40))
    kind: Mapped[CategoryKind] = mapped_column(String(10))
    # A mãe não tem mãe (dois níveis) e tem o mesmo `kind`; as duas regras ficam no serviço.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE")
    )
    icon: Mapped[str] = mapped_column(String(40))
    color: Mapped[CategoryColor] = mapped_column(String(20))
    # Marca a "Outros" de cada tipo, que recebe o que não tem categoria e não pode ser arquivada.
    is_fallback: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
