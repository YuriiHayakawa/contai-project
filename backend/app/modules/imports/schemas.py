"""Entradas e saídas das rotas de Importações (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Annotated, Self

from pydantic import BaseModel, Field

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


class TotalCheck(BaseModel):
    """O total impresso no documento contra a soma das linhas extraídas (FR-043)."""

    document_total_cents: int
    extracted_total_cents: int
    matches: bool


class BalanceCheck(BaseModel):
    """O saldo informado pelo banco contra o saldo calculado da conta na mesma data (FR-082).

    Na revisão, o saldo calculado é o da conta mais as linhas marcadas. Quando o usuário marca
    ou desmarca uma linha, a conta se refaz com `account_balance_cents` mais as linhas marcadas
    que têm data de `counted_from` a `bank_balance_date`.
    """

    bank_balance_cents: int
    bank_balance_date: dt.date
    # Saldo da conta nessa data, sem as linhas deste arquivo.
    account_balance_cents: int
    # Data de referência do saldo inicial da conta: linhas anteriores a ela não mudam o saldo.
    counted_from: dt.date
    # Com as linhas marcadas por padrão; depois da confirmação, o saldo da conta nessa data.
    computed_balance_cents: int
    matches: bool


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
    # Só quando o documento traz um total.
    total_check: TotalCheck | None = None
    # Só quando o arquivo informa o saldo, em `awaiting_review` e em `completed`.
    balance_check: BalanceCheck | None = None


class ImportPage(BaseModel):
    """Uma página do histórico, da importação mais nova para a mais antiga."""

    items: list[ImportRead]
    # Passe em `cursor` para buscar a página seguinte; `null` na última.
    next_cursor: str | None


class ConfirmItem(BaseModel):
    """A decisão final de uma linha da revisão.

    Os campos de uma linha desmarcada não são conferidos: ela não vira transação.
    """

    id: uuid.UUID
    selected: bool
    type: TransactionType | None = None
    amount_cents: int | None = None
    date: dt.date | None = None
    description: str | None = None
    # Obrigatória em despesa e receita.
    category_id: uuid.UUID | None = None
    # Obrigatória em transferência: a outra conta, como o cartão em um pagamento de fatura.
    counter_account_id: uuid.UUID | None = None


class ImportConfirm(BaseModel):
    # Todas as linhas da revisão, cada uma uma vez.
    items: Annotated[list[ConfirmItem], Field(max_length=5_000)]
