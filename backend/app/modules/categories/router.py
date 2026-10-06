"""Rotas de categorias. Só validam a entrada, chamam o serviço e formatam a resposta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.categories.schemas import (
    CategoryCreate,
    CategoryRead,
    CategoryTree,
    CategoryUpdate,
)
from app.modules.categories.service import CategoryService

router = APIRouter(prefix="/api/v1/categories", tags=["categories"])


def get_category_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CategoryService:
    return CategoryService(session)


CategoryServiceDep = Annotated[CategoryService, Depends(get_category_service)]


@router.get("", summary="Árvore de categorias, em dois níveis, por tipo")
async def list_categories(
    current: CurrentUserDep, service: CategoryServiceDep, include_archived: bool = False
) -> CategoryTree:
    return await service.tree(current.id, include_archived=include_archived)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Criar uma categoria ou subcategoria",
    description="`color` é um dos oito nomes da paleta do design system; outro valor dá `422`.",
)
async def create_category(
    body: CategoryCreate, current: CurrentUserDep, service: CategoryServiceDep
) -> CategoryRead:
    return await service.create(current.id, body)


@router.patch("/{category_id}", summary="Editar nome, ícone e cor")
async def update_category(
    category_id: uuid.UUID,
    body: CategoryUpdate,
    current: CurrentUserDep,
    service: CategoryServiceDep,
) -> CategoryRead:
    return await service.update(current.id, category_id, body)


@router.post(
    "/{category_id}/archive",
    summary="Arquivar uma categoria",
    description='Arquivar a categoria principal arquiva as subcategorias. A "Outros" dá `409`.',
)
async def archive_category(
    category_id: uuid.UUID, current: CurrentUserDep, service: CategoryServiceDep
) -> CategoryRead:
    return await service.archive(current.id, category_id)


@router.post("/{category_id}/unarchive", summary="Desarquivar uma categoria")
async def unarchive_category(
    category_id: uuid.UUID, current: CurrentUserDep, service: CategoryServiceDep
) -> CategoryRead:
    return await service.unarchive(current.id, category_id)
