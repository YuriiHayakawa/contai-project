"""Rotas do usuário sobre a própria conta."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
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


@router.post(
    "/me/consents/ai-documents",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Aceitar o aviso sobre o envio de PDF e imagem",
    description=(
        "Registra que o usuário leu e aceitou o aviso: o conteúdo de PDFs e imagens é "
        "processado por um serviço de IA externo, que pode usar os dados para melhorar seus "
        "modelos. Sem o aceite, o envio de PDF ou imagem responde `403 ai_consent_required`."
    ),
)
async def accept_ai_documents(current: CurrentUserDep, service: UserServiceDep) -> None:
    await service.accept_ai_documents(current.id)
