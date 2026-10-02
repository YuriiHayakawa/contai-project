"""Rotas de transações. Só validam a entrada, chamam o serviço e formatam a resposta."""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.transactions.models import TransactionType
from app.modules.transactions.schemas import (
    TransactionCreate,
    TransactionPage,
    TransactionRead,
    TransactionUpdate,
)
from app.modules.transactions.service import TransactionService

router = APIRouter(prefix="/api/v1/transactions", tags=["transactions"])

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def get_transaction_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TransactionService:
    return TransactionService(session)


TransactionServiceDep = Annotated[TransactionService, Depends(get_transaction_service)]


@router.get(
    "",
    summary="Buscar transações",
    description=(
        "Os filtros se combinam: só voltam as transações que atendem a todos. A lista vem da "
        "mais nova para a mais antiga."
    ),
)
async def list_transactions(
    current: CurrentUserDep,
    service: TransactionServiceDep,
    date_from: Annotated[
        dt.date | None, Query(alias="from", description="Data inicial, inclusive")
    ] = None,
    date_to: Annotated[
        dt.date | None, Query(alias="to", description="Data final, inclusive")
    ] = None,
    account_id: uuid.UUID | None = None,
    category_id: Annotated[
        uuid.UUID | None, Query(description="Inclui as subcategorias da categoria")
    ] = None,
    type: Annotated[TransactionType | None, Query()] = None,
    q: Annotated[
        str | None,
        Query(max_length=100, description="Texto procurado na descrição e na observação"),
    ] = None,
    installment_group_id: uuid.UUID | None = None,
    ids: Annotated[list[uuid.UUID] | None, Query(max_length=MAX_PAGE_SIZE)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> TransactionPage:
    return await service.search(
        current.id,
        date_from=date_from,
        date_to=date_to,
        account_id=account_id,
        category_id=category_id,
        transaction_type=type,
        text=q,
        installment_group_id=installment_group_id,
        ids=ids,
        limit=limit,
        cursor=cursor,
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Lançar uma despesa ou receita")
async def create_transaction(
    body: TransactionCreate, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionRead:
    return await service.create(current.id, body)


@router.get("/{transaction_id}", summary="Ver uma transação")
async def get_transaction(
    transaction_id: uuid.UUID, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionRead:
    return await service.get(current.id, transaction_id)


@router.patch("/{transaction_id}", summary="Editar uma transação")
async def update_transaction(
    transaction_id: uuid.UUID,
    body: TransactionUpdate,
    current: CurrentUserDep,
    service: TransactionServiceDep,
) -> TransactionRead:
    return await service.update(current.id, transaction_id, body)


@router.delete(
    "/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir uma transação"
)
async def delete_transaction(
    transaction_id: uuid.UUID, current: CurrentUserDep, service: TransactionServiceDep
) -> None:
    await service.delete(current.id, transaction_id)
