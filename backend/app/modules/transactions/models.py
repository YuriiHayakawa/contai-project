"""Modelo de transação: despesa, receita ou um dos dois lados de uma transferência."""

import datetime as dt
import uuid
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey


class TransactionType(StrEnum):
    EXPENSE = "expense"
    INCOME = "income"
    TRANSFER = "transfer"


class TransferDirection(StrEnum):
    OUT = "out"
    IN = "in"


class TransactionSource(StrEnum):
    MANUAL = "manual"
    IMPORT = "import"
    ASSISTANT = "assistant"


def _in_list(column: str, values: type[StrEnum]) -> str:
    return f"{column} IN ({', '.join(repr(item.value) for item in values)})"


class Transaction(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint(_in_list("type", TransactionType), name="type_valid"),
        CheckConstraint(_in_list("source", TransactionSource), name="source_valid"),
        CheckConstraint("amount_cents > 0", name="amount_positive"),
        CheckConstraint("char_length(description) BETWEEN 1 AND 200", name="description_length"),
        # Transferência: tem direção e grupo, e não tem categoria. Despesa e receita: o inverso.
        CheckConstraint(
            "(type = 'transfer' AND transfer_direction IN ('out', 'in') "
            "AND transfer_group_id IS NOT NULL AND category_id IS NULL) "
            "OR (type <> 'transfer' AND transfer_direction IS NULL "
            "AND transfer_group_id IS NULL AND category_id IS NOT NULL)",
            name="transfer_fields_match_type",
        ),
        # Parcela: grupo, número e total andam juntos; de 2 a 48 parcelas.
        CheckConstraint(
            "(installment_group_id IS NULL AND installment_number IS NULL "
            "AND installment_count IS NULL) "
            "OR (installment_group_id IS NOT NULL AND installment_count BETWEEN 2 AND 48 "
            "AND installment_number BETWEEN 1 AND installment_count)",
            name="installment_fields_consistent",
        ),
        Index("ix_transactions_user_id_date", "user_id", "date"),
        Index("ix_transactions_user_id_account_id_date", "user_id", "account_id", "date"),
        Index("ix_transactions_user_id_category_id_date", "user_id", "category_id", "date"),
        Index(
            "ix_transactions_user_id_account_id_fingerprint", "user_id", "account_id", "fingerprint"
        ),
        Index("ix_transactions_import_id", "import_id"),
        # O banco impede a duplicata de um identificador externo (por exemplo, o FITID do OFX).
        Index(
            "uq_transactions_account_id_external_id",
            "account_id",
            "external_id",
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Uma conta com transações não pode ser apagada, só arquivada (FR-022).
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    type: Mapped[TransactionType] = mapped_column(String(10))
    transfer_direction: Mapped[TransferDirection | None] = mapped_column(String(3))
    # Sempre maior que zero; o sinal vem do tipo e da direção.
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    # `dt.date`, e não `date`: o atributo tem o mesmo nome do tipo.
    date: Mapped[dt.date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(200))
    # Minúscula, sem acentos, pontuação e números: base das regras de categoria e das duplicatas.
    description_normalized: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))
    transfer_group_id: Mapped[uuid.UUID | None]
    installment_group_id: Mapped[uuid.UUID | None]
    installment_number: Mapped[int | None] = mapped_column(Integer)
    installment_count: Mapped[int | None] = mapped_column(Integer)
    # Importação que criou a linha. Apagar a importação não apaga a transação.
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("imports.id", ondelete="SET NULL")
    )
    external_id: Mapped[str | None] = mapped_column(String(255))
    # Hash de conta, data, tipo, valor e descrição normalizada.
    fingerprint: Mapped[str] = mapped_column(String(64))
    source: Mapped[TransactionSource] = mapped_column(
        String(10), server_default=TransactionSource.MANUAL.value
    )
