"""Modelos da importação: a importação, as transações propostas e os modelos de colunas.

As transações propostas (`import_items`) só existem entre o processamento e a confirmação:
nada vira transação sem o usuário confirmar (FR-046).
"""

import datetime as dt
import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, Timestamps, UUIDPrimaryKey
from app.modules.transactions.models import TransactionType, TransferDirection


class ImportKind(StrEnum):
    STATEMENT = "statement"
    RECEIPT = "receipt"


class ImportFormat(StrEnum):
    OFX = "ofx"
    CSV = "csv"
    XLSX = "xlsx"
    PDF = "pdf"
    IMAGE = "image"


class ImportStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    AWAITING_MAPPING = "awaiting_mapping"
    AWAITING_REVIEW = "awaiting_review"
    COMPLETED = "completed"
    UNDONE = "undone"
    FAILED = "failed"


class DuplicateStatus(StrEnum):
    NONE = "none"
    EXACT = "exact"
    PROBABLE = "probable"


class CategorySource(StrEnum):
    USER_RULE = "user_rule"
    AI = "ai"
    FALLBACK = "fallback"


def _in_list(column: str, values: type[StrEnum]) -> str:
    return f"{column} IN ({', '.join(repr(item.value) for item in values)})"


class ImportTemplate(UUIDPrimaryKey, Timestamps, Base):
    """Modelo de colunas de um CSV ou planilha, reaplicado a arquivos com o mesmo cabeçalho."""

    __tablename__ = "import_templates"
    __table_args__ = (
        Index(
            "uq_import_templates_user_id_header_signature",
            "user_id",
            "header_signature",
            unique=True,
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Hash dos nomes de colunas normalizados, na ordem em que aparecem.
    header_signature: Mapped[str] = mapped_column(String(64))
    # Colunas de data, descrição e valor (ou entrada e saída), formato da data, separador
    # decimal e convenção de sinal.
    mapping: Mapped[dict[str, Any]] = mapped_column(JSONB)
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Import(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "imports"
    __table_args__ = (
        CheckConstraint(_in_list("kind", ImportKind), name="kind_valid"),
        CheckConstraint(_in_list("format", ImportFormat), name="format_valid"),
        CheckConstraint(_in_list("status", ImportStatus), name="status_valid"),
        Index("ix_imports_user_id_created_at", "user_id", "created_at"),
        Index("ix_imports_user_id_file_hash", "user_id", "file_hash"),
        Index("ix_imports_account_id", "account_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Conta de destino (FR-036). Só uma conta sem transações pode ser excluída, e com ela vai
    # o histórico das importações que não deixaram nada nela.
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    kind: Mapped[ImportKind] = mapped_column(String(10))
    format: Mapped[ImportFormat] = mapped_column(String(10))
    # Só para o histórico; nunca vai para logs.
    original_filename: Mapped[str] = mapped_column(String(255))
    # SHA-256 do arquivo: avisa quando o mesmo arquivo já foi importado.
    file_hash: Mapped[str] = mapped_column(String(64))
    # Nome gerado no volume privado; nulo depois que o arquivo é apagado (FR-053).
    stored_filename: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[ImportStatus] = mapped_column(
        String(20), server_default=ImportStatus.QUEUED.value
    )
    error_code: Mapped[str | None] = mapped_column(String(50))
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_templates.id", ondelete="SET NULL")
    )
    # Cabeçalho e primeiras linhas para a tela de mapeamento; apagado depois.
    mapping_preview: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    document_total_cents: Mapped[int | None] = mapped_column(BigInteger)
    extracted_total_cents: Mapped[int | None] = mapped_column(BigInteger)
    # Saldo informado pelo arquivo, quando houver (FR-082), e a data dele.
    bank_balance_cents: Mapped[int | None] = mapped_column(BigInteger)
    bank_balance_date: Mapped[dt.date | None] = mapped_column(Date)
    item_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    imported_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    # Desde quando espera o usuário (mapeamento ou revisão): base do prazo do FR-083.
    waiting_since: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    undone_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class ImportItem(UUIDPrimaryKey, Base):
    """Uma transação proposta, à espera da revisão do usuário."""

    __tablename__ = "import_items"
    __table_args__ = (
        CheckConstraint(_in_list("type", TransactionType), name="type_valid"),
        CheckConstraint(
            "transfer_direction IS NULL OR transfer_direction IN ('out', 'in')",
            name="transfer_direction_valid",
        ),
        CheckConstraint("amount_cents > 0", name="amount_positive"),
        CheckConstraint(
            _in_list("duplicate_status", DuplicateStatus), name="duplicate_status_valid"
        ),
        CheckConstraint(
            f"category_source IS NULL OR {_in_list('category_source', CategorySource)}",
            name="category_source_valid",
        ),
        Index("ix_import_items_import_id_row_index", "import_id", "row_index"),
        Index("ix_import_items_user_id", "user_id"),
    )

    import_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Ordem no documento.
    row_index: Mapped[int] = mapped_column(Integer)
    type: Mapped[TransactionType] = mapped_column(String(10))
    # Preenchido quando a linha é sugerida como transferência.
    transfer_direction: Mapped[TransferDirection | None] = mapped_column(String(3))
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    date: Mapped[dt.date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(200))
    description_normalized: Mapped[str] = mapped_column(String(200))
    suggested_category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    category_source: Mapped[CategorySource | None] = mapped_column(String(10))
    # Cartão ou conta sugerida em pagamento de fatura (FR-081).
    suggested_counter_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL")
    )
    external_id: Mapped[str | None] = mapped_column(String(255))
    fingerprint: Mapped[str] = mapped_column(String(64))
    duplicate_status: Mapped[DuplicateStatus] = mapped_column(
        String(10), server_default=DuplicateStatus.NONE.value
    )
    # Transação existente que motivou o aviso de duplicata.
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL")
    )
    # Falso para `exact` e `probable`: duplicata chega desmarcada (FR-049).
    selected_by_default: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
