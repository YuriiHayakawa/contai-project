"""Entradas e saídas das rotas de Transações (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints

from app.modules.transactions.models import (
    Transaction,
    TransactionSource,
    TransactionType,
    TransferDirection,
)

Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
# Sempre em centavos, inteiro e maior que zero; o sinal vem do tipo.
AmountCents = Annotated[int, Field(gt=0, le=9_999_999_999_99)]
# Transferências têm rota própria: aqui só entram despesa e receita.
EntryType = Literal[TransactionType.EXPENSE, TransactionType.INCOME]


class TransactionCreate(BaseModel):
    type: EntryType
    amount_cents: AmountCents
    date: dt.date
    description: Description
    account_id: uuid.UUID
    category_id: uuid.UUID
    notes: Notes | None = None


class TransactionUpdate(BaseModel):
    """Só os campos enviados mudam. `notes: null` apaga a observação."""

    type: EntryType | None = None
    amount_cents: AmountCents | None = None
    date: dt.date | None = None
    description: Description | None = None
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    notes: Notes | None = None


class TransactionRead(BaseModel):
    id: uuid.UUID
    type: TransactionType
    transfer_direction: TransferDirection | None
    amount_cents: int
    date: dt.date
    description: str
    notes: str | None
    account_id: uuid.UUID
    category_id: uuid.UUID | None
    transfer_group_id: uuid.UUID | None
    installment_group_id: uuid.UUID | None
    installment_number: int | None
    installment_count: int | None
    source: TransactionSource
    created_at: dt.datetime

    @classmethod
    def from_transaction(cls, transaction: Transaction) -> Self:
        direction = transaction.transfer_direction
        return cls(
            id=transaction.id,
            type=TransactionType(transaction.type),
            transfer_direction=TransferDirection(direction) if direction else None,
            amount_cents=transaction.amount_cents,
            date=transaction.date,
            description=transaction.description,
            notes=transaction.notes,
            account_id=transaction.account_id,
            category_id=transaction.category_id,
            transfer_group_id=transaction.transfer_group_id,
            installment_group_id=transaction.installment_group_id,
            installment_number=transaction.installment_number,
            installment_count=transaction.installment_count,
            source=TransactionSource(transaction.source),
            created_at=transaction.created_at,
        )


class TransactionPage(BaseModel):
    items: list[TransactionRead]
    # Passe em `cursor` para buscar a página seguinte; `null` na última.
    next_cursor: str | None
    # Quantas transações atendem aos filtros, somando todas as páginas.
    total_count: int
