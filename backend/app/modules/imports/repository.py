"""Acesso ao banco para importações, transações propostas e modelos de colunas.

Todo método exige `user_id`.
"""

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.imports.models import (
    DuplicateStatus,
    Import,
    ImportFormat,
    ImportItem,
    ImportKind,
    ImportStatus,
    ImportTemplate,
)
from app.modules.transactions.models import TransactionType


@dataclass(frozen=True)
class NewItem:
    """Uma transação proposta pronta para ser gravada."""

    row_index: int
    type: TransactionType
    amount_cents: int
    date: dt.date
    description: str
    description_normalized: str
    fingerprint: str
    external_id: str | None
    duplicate_status: DuplicateStatus
    duplicate_of_id: uuid.UUID | None
    selected_by_default: bool


class ImportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ---------- importações

    async def create(
        self,
        user_id: uuid.UUID,
        *,
        account_id: uuid.UUID,
        kind: ImportKind,
        file_format: ImportFormat,
        original_filename: str,
        file_hash: str,
        stored_filename: str,
        created_at: dt.datetime,
    ) -> Import:
        record = Import(
            user_id=user_id,
            account_id=account_id,
            kind=kind,
            format=file_format,
            original_filename=original_filename,
            file_hash=file_hash,
            stored_filename=stored_filename,
            status=ImportStatus.QUEUED,
            # O instante vem do relógio da aplicação: é ele que ordena o histórico.
            created_at=created_at,
            updated_at=created_at,
        )
        self._session.add(record)
        await self._session.flush()
        await self._session.refresh(record)
        return record

    async def get(
        self, user_id: uuid.UUID, import_id: uuid.UUID, *, for_update: bool = False
    ) -> Import | None:
        """`for_update` trava a linha: dois pedidos não mudam o estado ao mesmo tempo."""
        statement = select(Import).where(Import.id == import_id, Import.user_id == user_id)
        if for_update:
            statement = statement.with_for_update()
        return (await self._session.execute(statement)).scalar_one_or_none()

    async def save(self, user_id: uuid.UUID, record: Import) -> Import:
        """Grava as alterações feitas em uma importação já carregada deste usuário."""
        if record.user_id != user_id:
            raise ValueError("a importação não é deste usuário")
        await self._session.flush()
        await self._session.refresh(record)
        return record

    async def completed_at_with_hash(
        self,
        user_id: uuid.UUID,
        *,
        account_id: uuid.UUID,
        file_hash: str,
        except_id: uuid.UUID,
    ) -> dt.datetime | None:
        """Quando este mesmo arquivo foi importado nesta conta, se já foi e não foi desfeito."""
        result = await self._session.execute(
            select(Import.completed_at)
            .where(
                Import.user_id == user_id,
                Import.account_id == account_id,
                Import.file_hash == file_hash,
                Import.status == ImportStatus.COMPLETED,
                Import.id != except_id,
            )
            .order_by(Import.completed_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ---------- transações propostas

    async def add_items(
        self, user_id: uuid.UUID, import_id: uuid.UUID, items: Sequence[NewItem]
    ) -> None:
        self._session.add_all(
            ImportItem(
                import_id=import_id,
                user_id=user_id,
                row_index=item.row_index,
                type=item.type,
                amount_cents=item.amount_cents,
                date=item.date,
                description=item.description,
                description_normalized=item.description_normalized,
                fingerprint=item.fingerprint,
                external_id=item.external_id,
                duplicate_status=item.duplicate_status,
                duplicate_of_id=item.duplicate_of_id,
                selected_by_default=item.selected_by_default,
            )
            for item in items
        )
        await self._session.flush()

    async def list_items(self, user_id: uuid.UUID, import_id: uuid.UUID) -> list[ImportItem]:
        """As transações propostas, na ordem do documento."""
        result = await self._session.execute(
            select(ImportItem)
            .where(ImportItem.import_id == import_id, ImportItem.user_id == user_id)
            .order_by(ImportItem.row_index)
        )
        return list(result.scalars())

    # ---------- modelos de colunas

    async def list_templates(self, user_id: uuid.UUID) -> list[ImportTemplate]:
        result = await self._session.execute(
            select(ImportTemplate).where(ImportTemplate.user_id == user_id)
        )
        return list(result.scalars())

    async def save_template(
        self, user_id: uuid.UUID, *, header_signature: str, mapping: dict[str, Any]
    ) -> None:
        """Guarda o modelo da estrutura; mapear de novo a mesma estrutura troca o modelo."""
        statement = insert(ImportTemplate).values(
            user_id=user_id, header_signature=header_signature, mapping=mapping
        )
        await self._session.execute(
            statement.on_conflict_do_update(
                index_elements=[ImportTemplate.user_id, ImportTemplate.header_signature],
                set_={"mapping": mapping, "updated_at": func.now()},
            )
        )

    async def delete_template(self, user_id: uuid.UUID, header_signature: str) -> None:
        await self._session.execute(
            delete(ImportTemplate).where(
                ImportTemplate.user_id == user_id,
                ImportTemplate.header_signature == header_signature,
            )
        )
