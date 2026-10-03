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
    EditScope,
    InstallmentPurchaseCreate,
    TransactionCreate,
    TransactionList,
    TransactionPage,
    TransactionRead,
    TransactionUpdate,
    TransferCreate,
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
ScopeParam = Annotated[
    EditScope,
    Query(
        description=(
            "Só em parcelas: `single` muda só esta; `following`, esta e as seguintes (FR-032)."
        )
    ),
]


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
    transfer_group_id: Annotated[
        uuid.UUID | None, Query(description="Os dois lados de uma transferência")
    ] = None,
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
        transfer_group_id=transfer_group_id,
        ids=ids,
        limit=limit,
        cursor=cursor,
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Lançar uma despesa ou receita")
async def create_transaction(
    body: TransactionCreate, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionRead:
    return await service.create(current.id, body)


@router.post(
    "/installments",
    status_code=status.HTTP_201_CREATED,
    summary="Lançar uma compra parcelada no cartão",
    description=(
        "Gera de 2 a 48 parcelas mensais; os centavos que sobram da divisão vão para a primeira."
    ),
)
async def create_installments(
    body: InstallmentPurchaseCreate, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionList:
    return TransactionList(items=await service.create_installments(current.id, body))


@router.post(
    "/transfers",
    status_code=status.HTTP_201_CREATED,
    summary="Transferir entre duas contas próprias",
    description="Cria a linha de saída e a de entrada. Não conta como receita nem como despesa.",
)
async def create_transfer(
    body: TransferCreate, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionList:
    return TransactionList(items=await service.create_transfer(current.id, body))


@router.get("/{transaction_id}", summary="Ver uma transação")
async def get_transaction(
    transaction_id: uuid.UUID, current: CurrentUserDep, service: TransactionServiceDep
) -> TransactionRead:
    return await service.get(current.id, transaction_id)


@router.patch(
    "/{transaction_id}",
    summary="Editar uma transação",
    description=(
        "Transferência muda nos dois lados. Com `scope=following` em uma parcela, devolve a "
        "lista das parcelas alteradas."
    ),
)
async def update_transaction(
    transaction_id: uuid.UUID,
    body: TransactionUpdate,
    current: CurrentUserDep,
    service: TransactionServiceDep,
    scope: ScopeParam = EditScope.SINGLE,
) -> TransactionRead | TransactionList:
    updated = await service.update(current.id, transaction_id, body, scope)
    return TransactionList(items=updated) if isinstance(updated, list) else updated


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir uma transação",
    description="Transferência sai dos dois lados; parcela, sozinha ou com as seguintes.",
)
async def delete_transaction(
    transaction_id: uuid.UUID,
    current: CurrentUserDep,
    service: TransactionServiceDep,
    scope: ScopeParam = EditScope.SINGLE,
) -> None:
    await service.delete(current.id, transaction_id, scope)
