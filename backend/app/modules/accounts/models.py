"""Modelo de conta: conta corrente, cartão de crédito, dinheiro, poupança ou investimento."""

import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class AccountType(StrEnum):
    CHECKING = "checking"
    CREDIT_CARD = "credit_card"
    CASH = "cash"
    SAVINGS = "savings"
    INVESTMENT = "investment"


_TYPES = ", ".join(repr(item.value) for item in AccountType)


class Account(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(f"type IN ({_TYPES})", name="type_valid"),
        CheckConstraint("char_length(name) BETWEEN 1 AND 60", name="name_length"),
        CheckConstraint("closing_day BETWEEN 1 AND 31", name="closing_day_range"),
        CheckConstraint("due_day BETWEEN 1 AND 31", name="due_day_range"),
        # Fechamento e vencimento: obrigatórios para cartão, nulos nos demais tipos.
        CheckConstraint(
            "(type = 'credit_card' AND closing_day IS NOT NULL AND due_day IS NOT NULL) "
            "OR (type <> 'credit_card' AND closing_day IS NULL AND due_day IS NULL)",
            name="card_days_match_type",
        ),
        Index("ix_accounts_user_id", "user_id"),
        # O nome é único entre as contas ativas do usuário; uma arquivada libera o nome.
        Index(
            "uq_accounts_user_id_name_active",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[AccountType] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(60))
    institution: Mapped[str | None] = mapped_column(String(60))
    # Com sinal: a dívida inicial de um cartão é negativa.
    initial_balance_cents: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    # Data de referência do saldo inicial: só transações a partir dela entram no saldo.
    initial_balance_date: Mapped[date] = mapped_column(Date)
    closing_day: Mapped[int | None] = mapped_column(Integer)
    due_day: Mapped[int | None] = mapped_column(Integer)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
