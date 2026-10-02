"""Rotas de contas. Só validam a entrada, chamam o serviço e formatam a resposta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.accounts.schemas import AccountCreate, AccountList, AccountRead, AccountUpdate
from app.modules.accounts.service import AccountService
from app.modules.auth.dependencies import CurrentUserDep

router = APIRouter(prefix="/api/v1/accounts", tags=["accounts"])


def get_account_service(session: Annotated[AsyncSession, Depends(get_session)]) -> AccountService:
    return AccountService(session)


AccountServiceDep = Annotated[AccountService, Depends(get_account_service)]


@router.get("", summary="Listar as contas, com o saldo de cada uma")
async def list_accounts(
    current: CurrentUserDep, service: AccountServiceDep, include_archived: bool = False
) -> AccountList:
    return AccountList(items=await service.list(current.id, include_archived=include_archived))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Cadastrar uma conta")
async def create_account(
    body: AccountCreate, current: CurrentUserDep, service: AccountServiceDep
) -> AccountRead:
    return await service.create(current.id, body)


@router.get("/{account_id}", summary="Ver uma conta")
async def get_account(
    account_id: uuid.UUID, current: CurrentUserDep, service: AccountServiceDep
) -> AccountRead:
    return await service.get(current.id, account_id)


@router.patch(
    "/{account_id}",
    summary="Editar uma conta",
    description="O tipo só pode mudar enquanto a conta não tem transações.",
)
async def update_account(
    account_id: uuid.UUID, body: AccountUpdate, current: CurrentUserDep, service: AccountServiceDep
) -> AccountRead:
    return await service.update(current.id, account_id, body)


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir uma conta sem transações",
    description="Uma conta com transações responde `409 account_has_transactions`: só arquiva.",
)
async def delete_account(
    account_id: uuid.UUID, current: CurrentUserDep, service: AccountServiceDep
) -> None:
    await service.delete(current.id, account_id)


@router.post("/{account_id}/archive", summary="Arquivar uma conta")
async def archive_account(
    account_id: uuid.UUID, current: CurrentUserDep, service: AccountServiceDep
) -> AccountRead:
    return await service.archive(current.id, account_id)


@router.post("/{account_id}/unarchive", summary="Desarquivar uma conta")
async def unarchive_account(
    account_id: uuid.UUID, current: CurrentUserDep, service: AccountServiceDep
) -> AccountRead:
    return await service.unarchive(current.id, account_id)
