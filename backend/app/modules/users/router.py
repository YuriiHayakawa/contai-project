"""Rotas do usuário sobre a própria conta."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.users.schemas import UserRead
from app.modules.users.service import UserService

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def get_user_service(session: Annotated[AsyncSession, Depends(get_session)]) -> UserService:
    return UserService(session)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]


@router.get("/me", summary="Perfil do usuário conectado")
async def get_me(current: CurrentUserDep, service: UserServiceDep) -> UserRead:
    return await service.get_profile(current.id)
