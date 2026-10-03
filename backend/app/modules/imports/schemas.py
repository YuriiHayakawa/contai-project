"""Entradas e saídas das rotas de Importações (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Self

from pydantic import BaseModel

from app.modules.imports.mapping import MappingSuggestion
from app.modules.imports.models import (
    CategorySource,
    DuplicateStatus,
    ImportFormat,
    ImportItem,
    ImportKind,
    ImportStatus,
)
from app.modules.transactions.models import TransactionType, TransferDirection


class ImportItemRead(BaseModel):
    """Uma transação proposta, para a revisão. Nada dela está salvo ainda (FR-046)."""

    id: uuid.UUID
    row_index: int
    type: TransactionType
    transfer_direction: TransferDirection | None
    amount_cents: int
    date: dt.date
    description: str
    suggested_category_id: uuid.UUID | None
    category_source: CategorySource | None
    suggested_counter_account_id: uuid.UUID | None
    duplicate_status: DuplicateStatus
    # Transação existente que motivou o aviso de duplicata.
    duplicate_of_id: uuid.UUID | None
    # Duplicata chega desmarcada (FR-049).
    selected_by_default: bool

    @classmethod
    def from_item(cls, item: ImportItem) -> Self:
        return cls(
            id=item.id,
            row_index=item.row_index,
            type=TransactionType(item.type),
            transfer_direction=(
                TransferDirection(item.transfer_direction) if item.transfer_direction else None
            ),
            amount_cents=item.amount_cents,
            date=item.date,
            description=item.description,
            suggested_category_id=item.suggested_category_id,
            category_source=CategorySource(item.category_source) if item.category_source else None,
            suggested_counter_account_id=item.suggested_counter_account_id,
            duplicate_status=DuplicateStatus(item.duplicate_status),
            duplicate_of_id=item.duplicate_of_id,
            selected_by_default=item.selected_by_default,
        )


class MappingPreviewRead(BaseModel):
    """O que a tela de mapeamento mostra. As colunas são indicadas pela posição, desde zero."""

    columns: list[str]
    # As primeiras linhas do arquivo, como estão nele.
    rows: list[list[str]]
    suggestion: MappingSuggestion


class ImportRead(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    kind: ImportKind
    format: ImportFormat
    original_filename: str
    status: ImportStatus
    error_code: str | None
    # O que fazer, em português, quando há `error_code`.
    error_message: str | None
    item_count: int
    imported_count: int
    created_at: dt.datetime
    completed_at: dt.datetime | None
    undone_at: dt.datetime | None
    # Até quando a importação espera o usuário, em `awaiting_mapping` e `awaiting_review`.
    expires_at: dt.datetime | None
    # Quando este mesmo arquivo já foi importado nesta conta.
    already_imported_at: dt.datetime | None
    # Só em `awaiting_mapping`.
    mapping_preview: MappingPreviewRead | None = None
    # Só em `awaiting_review`.
    items: list[ImportItemRead] | None = None
